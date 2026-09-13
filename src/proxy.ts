import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { logger } from '@/lib/logger';
import { recordProxyDecision, type ProxyDecision } from '@/lib/metrics';
import { newTraceContext, REQUEST_ID_HEADER, type TraceContext } from '@/lib/observability/trace';
import { checkRateLimit } from '@/lib/rateLimit';

/**
 * Next.js Proxy — runs on every matched request.
 * Handles: request IDs, auth redirects, rate limiting, security headers.
 *
 * HTTP metrics are not recorded here: the proxy returns before the route
 * handler runs, so it can see neither the real status code nor the real
 * duration. They come from the request span in lib/observability/httpMetrics.ts.
 */

// Routes that require authentication
const PROTECTED_ROUTES = [
    '/dashboard',
    '/groups',
    '/contacts',
    '/transactions',
    '/settlements',
    '/analytics',
    '/settings',
];

// Routes that should redirect to dashboard if already authenticated
const AUTH_ROUTES = ['/login', '/register'];

/**
 * Check if the user has a valid session token cookie.
 * In production NextAuth uses __Secure- prefix; in dev it doesn't.
 */
function hasSessionToken(request: NextRequest): boolean {
    return (
        request.cookies.has('__Secure-authjs.session-token') ||
        request.cookies.has('authjs.session-token')
    );
}

/** Lets the request continue to its route, carrying this request's trace. */
function forward(request: NextRequest, trace: TraceContext) {
    const headers = new Headers(request.headers);
    headers.set('traceparent', trace.traceparent);
    headers.delete('tracestate');
    headers.set(REQUEST_ID_HEADER, trace.traceId);
    return NextResponse.next({ request: { headers } });
}

// Set by the Kubernetes downward API. Naming the pod in each response makes load
// balancing across replicas visible; outside Kubernetes nothing is exposed.
const SERVED_BY = process.env.POD_NAME;

function decide(request: NextRequest, trace: TraceContext, response: NextResponse, decision: ProxyDecision) {
    response.headers.set(REQUEST_ID_HEADER, trace.traceId);
    if (SERVED_BY) response.headers.set('x-served-by', SERVED_BY);
    recordProxyDecision(decision, request.method, response.status);
    if (decision === 'redirect_login' || decision === 'redirect_dashboard' || decision === 'rate_limited') {
        // Requests answered here never reach a route, so they get their access log line here.
        logger.info('request', {
            requestId: trace.traceId,
            method: request.method,
            route: '(proxy)',
            path: request.nextUrl.pathname,
            status: response.status,
            decision,
        });
    }
    return response;
}

export async function proxy(request: NextRequest) {
    const { pathname } = request.nextUrl;
    const trace = newTraceContext();

    // ── Auth Route Protection ──
    // Skip auth checks for static assets and API routes (API routes have their own auth)
    if (!pathname.startsWith('/api') && !pathname.startsWith('/_next')) {
        const isAuthenticated = hasSessionToken(request);

        // Redirect authenticated users away from login/register
        if (isAuthenticated && AUTH_ROUTES.some((route) => pathname.startsWith(route))) {
            return decide(request, trace, NextResponse.redirect(new URL('/dashboard', request.url)), 'redirect_dashboard');
        }

        // Redirect unauthenticated users away from protected routes
        if (!isAuthenticated && PROTECTED_ROUTES.some((route) => pathname.startsWith(route))) {
            const loginUrl = new URL('/login', request.url);
            loginUrl.searchParams.set('callbackUrl', pathname);
            return decide(request, trace, NextResponse.redirect(loginUrl), 'redirect_login');
        }
    }

    // ── Rate Limiting ──
    const limit = await checkRateLimit(request);

    if (limit.outcome === 'skip') {
        return decide(request, trace, forward(request, trace), 'pass');
    }

    if (limit.outcome === 'disabled' || limit.outcome === 'error') {
        // Fail open: a missing or unavailable limiter must not take the API down.
        const response = forward(request, trace);
        applySecurityHeaders(response);
        return decide(request, trace, response, limit.outcome === 'error' ? 'limiter_error' : 'pass');
    }

    const retryAfterSeconds = Math.max(1, Math.ceil(limit.resetMs / 1000));
    const response = limit.outcome === 'allow'
        ? forward(request, trace)
        : NextResponse.json(
            {
                success: false,
                error: 'Too many requests. Please wait a moment.',
                code: 'RATE_LIMITED',
                requestId: trace.traceId,
            },
            { status: 429 }
        );

    response.headers.set('X-RateLimit-Limit', String(limit.limit));
    response.headers.set('X-RateLimit-Remaining', String(limit.remaining));
    response.headers.set('X-RateLimit-Reset', String(retryAfterSeconds));
    if (limit.outcome === 'deny') {
        response.headers.set('Retry-After', String(retryAfterSeconds));
        logger.warn('Rate limit exceeded', {
            requestId: trace.traceId,
            policy: limit.policy.name,
            identity: limit.identity.kind,
            path: pathname,
        });
    }

    // ── Security Headers ──
    applySecurityHeaders(response);

    return decide(request, trace, response, limit.outcome === 'allow' ? 'pass' : 'rate_limited');
}

/** Apply standard security headers to a response */
function applySecurityHeaders(response: NextResponse) {
    response.headers.set('X-DNS-Prefetch-Control', 'on');
    response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('X-Frame-Options', 'DENY');
    response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
}

export const config = {
    matcher: [
        /*
         * Match all paths except:
         * - _next/static (static files)
         * - _next/image (image optimization)
         * - favicon.ico, icons, manifest, sw.js (PWA assets)
         */
        '/((?!_next/static|_next/image|favicon\\.ico|icons|manifest\\.json|sw\\.js|workbox-.*\\.js).*)',
    ],
};
