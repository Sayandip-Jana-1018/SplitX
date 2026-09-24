import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { logger } from '@/lib/logger';
import { metrics, recordProxyDecision, type ProxyDecision } from '@/lib/metrics';
import { newTraceContext, REQUEST_ID_HEADER, type TraceContext } from '@/lib/observability/trace';
import { checkRateLimit } from '@/lib/rateLimit';
import { clientIp } from '@/lib/rateLimit/clientIp';
import { hitLocally } from '@/lib/rateLimit/local';
import { DEVICE_COOKIE, deviceCookieOptions, mintDevice, verifyDevice } from '@/lib/rateLimit/device';
import { verifiedSessionUserId } from '@/lib/rateLimit/identity';
import { PREVIEW_ADMISSION_HEADER, tryAdmitPreview } from '@/lib/previewAdmission';
import { arrivalTime, previewMaxQueueMs, REQUEST_START_HEADER, requestStartValue } from '@/lib/requestQueue';

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
    '/history',
    '/admin',
    '/ops',
];

// Routes that should redirect to dashboard if already authenticated
const AUTH_ROUTES = ['/login', '/register'];

// A session cookie: __Secure- in production, and split into .0, .1… when large.
const SESSION_COOKIE = /^(__Secure-)?authjs\.session-token(\.\d+)?$/;

/** Whether the request carries a session cookie at all, genuine or not. */
function hasSessionToken(request: NextRequest): boolean {
    return request.cookies.getAll().some(({ name }) => SESSION_COOKIE.test(name));
}

/**
 * Whether the visitor is signed in, for the page gate. A cookie counts only if
 * it is a session this server issued and it hasn't expired, checked with the
 * auth secret (the same cached decode the rate limiter uses). A session that
 * was ended everywhere still verifies; its pages' API calls answer 401 and the
 * page signs out (lib/signOut.ts). Without a secret nothing can be checked, and
 * a cookie counts as before.
 */
async function sessionState(request: NextRequest): Promise<'none' | 'valid' | 'stale'> {
    if (!hasSessionToken(request)) return 'none';
    if (!(process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET)) return 'valid';
    return (await verifiedSessionUserId(request)) ? 'valid' : 'stale';
}

/** Tells the browser to drop a session cookie that no longer works. */
function clearSessionCookies(request: NextRequest, response: NextResponse) {
    for (const { name } of request.cookies.getAll()) {
        if (!SESSION_COOKIE.test(name)) continue;
        response.cookies.set(name, '', {
            path: '/',
            maxAge: 0,
            httpOnly: true,
            sameSite: 'lax',
            // A __Secure- cookie can only be replaced, even by an expired one, over HTTPS with Secure set.
            secure: name.startsWith('__Secure-') || isHttps(request),
        });
    }
    return response;
}

/**
 * On the EKS platform, only requests that came through SplitX's own edge. The
 * load balancer admits CloudFront's addresses, and every CloudFront
 * distribution shares them, so anyone could put a distribution of their own in
 * front of it and skip ours: its HTTPS redirect, and the function that refuses
 * the internal paths. Ours adds this header with a value only it has
 * (terraform/edge, from Secrets Manager). Where ORIGIN_VERIFY_SECRET is unset
 * (Vercel, Kind) nothing changes.
 */
const ORIGIN_VERIFY_HEADER = 'x-origin-verify';
// Reached directly, not through the edge: the load balancer's health check and
// the kubelet's probes, and Prometheus (whose endpoint wants its own token).
const DIRECT_PATHS = new Set(['/api/health/live', '/api/health/ready', '/api/metrics']);

function fromOurEdge(request: NextRequest): boolean {
    const expected = process.env.ORIGIN_VERIFY_SECRET;
    if (!expected || DIRECT_PATHS.has(request.nextUrl.pathname)) return true;
    const given = Buffer.from(request.headers.get(ORIGIN_VERIFY_HEADER) ?? '');
    const wanted = Buffer.from(expected);
    return given.length === wanted.length && timingSafeEqual(given, wanted);
}

/** Lets the request continue to its route, carrying its trace and arrival time. */
function forward(request: NextRequest, trace: TraceContext, receivedAt: number, previewAdmission?: string) {
    const headers = new Headers(request.headers);
    // The routes never see the edge's secret.
    headers.delete(ORIGIN_VERIFY_HEADER);
    headers.set('traceparent', trace.traceparent);
    headers.delete('tracestate');
    headers.set(REQUEST_ID_HEADER, trace.traceId);
    headers.set(REQUEST_START_HEADER, requestStartValue(receivedAt));
    // Only this proxy grants admissions. A value sent by a client would let one
    // request release the slot another request is holding.
    headers.delete(PREVIEW_ADMISSION_HEADER);
    if (previewAdmission) headers.set(PREVIEW_ADMISSION_HEADER, previewAdmission);
    return NextResponse.next({ request: { headers } });
}

function overloaded(trace: TraceContext) {
    const response = NextResponse.json(
        { success: false, error: 'SplitX is busy right now. Please try again in a moment.', code: 'OVERLOADED', requestId: trace.traceId },
        { status: 503, headers: { 'Retry-After': '1' } }
    );
    applySecurityHeaders(response);
    return response;
}

/** Whether the visitor's own connection is HTTPS, as reported by the proxy that terminated it. */
function isHttps(request: NextRequest) {
    const forwarded = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
    return forwarded ? forwarded === 'https' : request.nextUrl.protocol === 'https:';
}

/**
 * Gives an anonymous browser a signed device identity to send back, so it is
 * rate limited as itself rather than as everyone on its network (B-015). Set on
 * the first response of any kind; a signed-in visitor is limited by account
 * and needs none.
 */
function ensureDeviceCookie(request: NextRequest, response: NextResponse) {
    if (hasSessionToken(request) || verifyDevice(request.cookies.get(DEVICE_COOKIE)?.value)) return;
    const value = mintDevice();
    if (value) response.cookies.set(DEVICE_COOKIE, value, deviceCookieOptions(isHttps(request)));
}

// Set by the Kubernetes downward API. Naming the pod in each response makes load
// balancing across replicas visible; outside Kubernetes nothing is exposed.
const SERVED_BY = process.env.POD_NAME;

function decide(request: NextRequest, trace: TraceContext, response: NextResponse, decision: ProxyDecision) {
    response.headers.set(REQUEST_ID_HEADER, trace.traceId);
    if (SERVED_BY) response.headers.set('x-served-by', SERVED_BY);
    ensureDeviceCookie(request, response);
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
    // The ingress's arrival time when it is trusted to stamp one (B-016), so the
    // wait before this proxy ran counts too.
    const receivedAt = arrivalTime(request.headers);
    const { pathname } = request.nextUrl;
    const trace = newTraceContext();

    // ── Only through our edge (EKS) ──
    // Counted, not logged: someone else's distribution could otherwise turn a
    // flood of refused requests into a flood of log lines.
    if (!fromOurEdge(request)) {
        const response = new NextResponse('Not available', {
            status: 403,
            headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
        });
        response.headers.set(REQUEST_ID_HEADER, trace.traceId);
        recordProxyDecision('origin_refused', request.method, response.status);
        return response;
    }

    // ── Auth Route Protection ──
    // Skip auth checks for static assets and API routes (API routes have their own auth)
    const isProtected = PROTECTED_ROUTES.some((route) => pathname.startsWith(route));
    const isAuthRoute = AUTH_ROUTES.some((route) => pathname.startsWith(route));
    if ((isProtected || isAuthRoute) && !pathname.startsWith('/api') && !pathname.startsWith('/_next')) {
        const session = await sessionState(request);

        // Redirect authenticated users away from login/register
        if (session === 'valid' && isAuthRoute) {
            return decide(request, trace, NextResponse.redirect(new URL('/dashboard', request.url)), 'redirect_dashboard');
        }

        // Redirect unauthenticated users away from protected routes. An expired
        // or forged cookie is dropped on the way: it used to count as signed
        // in, and the page's own requests failed instead.
        if (session !== 'valid' && isProtected) {
            const loginUrl = new URL('/login', request.url);
            loginUrl.searchParams.set('callbackUrl', pathname);
            return decide(request, trace, clearSessionCookies(request, NextResponse.redirect(loginUrl)), 'redirect_login');
        }

        // Sign-in shows as usual and drops a cookie that no longer works; no
        // redirect, so a cookie that won't clear can't start a loop. (Pages are
        // never rate limited.)
        if (session === 'stale') {
            return decide(request, trace, clearSessionCookies(request, forward(request, trace, receivedAt)), 'pass');
        }
    }

    // ── Load shedding at the front door ──
    // A settlement preview that has already waited past its budget is refused
    // here, before the rate limiter's Redis round trip and before its body is
    // read. Refusing it in the route came too late: under overload the steps in
    // front of the route were the queue, refused requests waited 22 s to hear
    // so, and liveness probes waited behind them. Counted, not logged, so an
    // overload cannot add a synchronous log write per refused request.
    const isPreview = request.method === 'POST' && pathname === '/api/settlements/preview';
    if (isPreview && Date.now() - receivedAt > previewMaxQueueMs()) {
        metrics.settlementPreviews.inc({ mode: 'unknown', outcome: 'shed' });
        return decide(request, trace, overloaded(trace), 'shed_queue');
    }

    // ── Rate Limiting ──
    const limit = await checkRateLimit(request);

    if (limit.outcome === 'skip') {
        return decide(request, trace, forward(request, trace, receivedAt), 'pass');
    }

    // A preview the limiter lets through still needs a free slot in this process
    // (lib/previewAdmission.ts): the cap on accepted work is what keeps the event
    // loop, and every probe waiting on it, responsive under overload.
    let admission: string | undefined;
    if (isPreview && limit.outcome !== 'deny') {
        if (!tryAdmitPreview(trace.traceId)) {
            metrics.settlementPreviews.inc({ mode: 'unknown', outcome: 'shed' });
            return decide(request, trace, overloaded(trace), 'shed_capacity');
        }
        admission = trace.traceId;
    }

    if (limit.outcome === 'disabled' || limit.outcome === 'error') {
        // Sign-in, registration and password reset fail closed: without the
        // shared limiter, this process counts them itself (lib/rateLimit/local.ts).
        if (limit.policy.name === 'auth') {
            const local = hitLocally(`auth:${clientIp(request.headers) ?? 'unknown'}`, limit.policy.limit, limit.policy.windowMs);
            if (!local.allowed) {
                const response = NextResponse.json(
                    { success: false, error: 'Too many requests. Please wait a moment.', code: 'RATE_LIMITED', requestId: trace.traceId },
                    { status: 429, headers: { 'Retry-After': String(Math.max(1, Math.ceil(local.resetMs / 1000))) } }
                );
                applySecurityHeaders(response);
                return decide(request, trace, response, 'rate_limited');
            }
        }
        // Everything else fails open: a missing or unavailable limiter must not take the API down.
        const response = forward(request, trace, receivedAt, admission);
        applySecurityHeaders(response);
        return decide(request, trace, response, limit.outcome === 'error' ? 'limiter_error' : 'pass');
    }

    const retryAfterSeconds = Math.max(1, Math.ceil(limit.resetMs / 1000));
    const response = limit.outcome === 'allow'
        ? forward(request, trace, receivedAt, admission)
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
            scope: limit.scope,
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
         * - favicon.ico, icons, manifest, sw.js, offline.html (PWA assets)
         * - tesseract/ (the on-device OCR engine, about 7 MB of static files)
         */
        '/((?!_next/static|_next/image|favicon\\.ico|icons|manifest\\.json|sw\\.js|offline\\.html|tesseract/).*)',
    ],
};
