import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { recordProxyDecision, type ProxyDecision } from '@/lib/metrics';

/**
 * Next.js Proxy — runs on every matched request.
 * Handles: Auth protection, Rate limiting, Security headers.
 *
 * HTTP metrics are not recorded here: the proxy returns before the route
 * handler runs, so it can see neither the real status code nor the real
 * duration. They come from the request span in lib/observability/httpMetrics.ts.
 */

// Built once per process — constructing it per request discards the limiter's
// in-memory cache and allocates on every call.
let ratelimit: Ratelimit | null | undefined;

function getRatelimit() {
    if (ratelimit !== undefined) return ratelimit;

    const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
    const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

    ratelimit = redisUrl && redisToken
        ? new Ratelimit({
            redis: new Redis({ url: redisUrl, token: redisToken }),
            limiter: Ratelimit.slidingWindow(50, '1 m'),
            analytics: true,
        })
        : null;
    return ratelimit;
}

// Paths to skip rate limiting. Probes and scrapes arrive every few seconds from
// inside the cluster and must never be throttled or wait on Redis.
const SKIP_PATHS = [
    '/api/auth',
    '/api/health/',
    '/api/metrics',
    '/_next',
    '/favicon',
];

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

function decide(request: NextRequest, response: NextResponse, decision: ProxyDecision) {
    recordProxyDecision(decision, request.method, response.status);
    return response;
}

export async function proxy(request: NextRequest) {
    const { pathname } = request.nextUrl;

    // ── Auth Route Protection ──
    // Skip auth checks for static assets and API routes (API routes have their own auth)
    if (!pathname.startsWith('/api') && !pathname.startsWith('/_next')) {
        const isAuthenticated = hasSessionToken(request);

        // Redirect authenticated users away from login/register
        if (isAuthenticated && AUTH_ROUTES.some((route) => pathname.startsWith(route))) {
            return decide(request, NextResponse.redirect(new URL('/dashboard', request.url)), 'redirect_dashboard');
        }

        // Redirect unauthenticated users away from protected routes
        if (!isAuthenticated && PROTECTED_ROUTES.some((route) => pathname.startsWith(route))) {
            const loginUrl = new URL('/login', request.url);
            loginUrl.searchParams.set('callbackUrl', pathname);
            return decide(request, NextResponse.redirect(loginUrl), 'redirect_login');
        }
    }

    // ── API Rate Limiting (only for /api routes) ──
    if (!pathname.startsWith('/api')) {
        return decide(request, NextResponse.next(), 'pass');
    }

    // Skip auth and internal routes
    if (SKIP_PATHS.some(p => pathname.startsWith(p))) {
        return decide(request, NextResponse.next(), 'pass');
    }

    // ── API Logging ──
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';

    console.log(`[API] ${request.method} ${pathname} — IP: ${ip} — ${new Date().toISOString()}`);

    // ── Global Upstash Rate Limiting ──
    const limiter = getRatelimit();
    if (!limiter) {
        const response = NextResponse.next();
        applySecurityHeaders(response);
        return decide(request, response, 'pass');
    }

    const { success, limit, reset, remaining } = await limiter.limit(ip);

    const response = success ? NextResponse.next() : NextResponse.json(
        {
            success: false,
            error: 'Too many requests. Please wait a moment.',
            code: 'RATE_LIMITED',
        },
        { status: 429 }
    );

    const retryAfter = Math.ceil((reset - Date.now()) / 1000);
    response.headers.set('X-RateLimit-Limit', String(limit));
    response.headers.set('X-RateLimit-Remaining', String(remaining));
    response.headers.set('X-RateLimit-Reset', String(retryAfter));
    if (!success) {
        response.headers.set('Retry-After', String(retryAfter));
        console.warn(`[API] Rate limit exceeded for IP: ${ip}`);
    }

    // ── Security Headers ──
    applySecurityHeaders(response);

    return decide(request, response, success ? 'pass' : 'rate_limited');
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
