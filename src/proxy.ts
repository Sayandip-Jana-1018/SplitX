import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

/**
 * Next.js Proxy — runs on every matched request.
 * Handles:
 * 1. Auth-based route protection & redirects
 * 2. Global API rate limiting using Upstash Redis
 * 3. Security headers
 */

function getRatelimit() {
    const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
    const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

    if (!redisUrl || !redisToken) {
        return null;
    }

    const redis = new Redis({
        url: redisUrl,
        token: redisToken,
    });

    return new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(50, '1 m'),
        analytics: true,
    });
}

// Paths to skip rate limiting
const SKIP_PATHS = [
    '/api/auth',
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

export async function proxy(request: NextRequest) {
    const { pathname } = request.nextUrl;

    // ── Auth Route Protection ──
    // Skip auth checks for static assets and API routes (API routes have their own auth)
    if (!pathname.startsWith('/api') && !pathname.startsWith('/_next')) {
        const isAuthenticated = hasSessionToken(request);

        // Redirect authenticated users away from login/register
        if (isAuthenticated && AUTH_ROUTES.some((route) => pathname.startsWith(route))) {
            return NextResponse.redirect(new URL('/dashboard', request.url));
        }

        // Redirect unauthenticated users away from protected routes
        if (!isAuthenticated && PROTECTED_ROUTES.some((route) => pathname.startsWith(route))) {
            const loginUrl = new URL('/login', request.url);
            loginUrl.searchParams.set('callbackUrl', pathname);
            return NextResponse.redirect(loginUrl);
        }
    }

    // ── API Rate Limiting (only for /api routes) ──
    if (!pathname.startsWith('/api')) {
        return NextResponse.next();
    }

    // Skip auth and internal routes
    if (SKIP_PATHS.some(p => pathname.startsWith(p))) {
        return NextResponse.next();
    }

    // ── API Logging ──
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const method = request.method;

    console.log(`[API] ${method} ${pathname} — IP: ${ip} — ${new Date().toISOString()}`);

    // ── Global Upstash Rate Limiting ──
    const ratelimit = getRatelimit();
    if (!ratelimit) {
        const response = NextResponse.next();
        response.headers.set('X-DNS-Prefetch-Control', 'on');
        response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
        response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
        response.headers.set('X-Content-Type-Options', 'nosniff');
        response.headers.set('X-Frame-Options', 'DENY');
        response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
        return response;
    }

    const id = ip;
    const { success, limit, reset, remaining } = await ratelimit.limit(id);

    // Provide some minimal headers
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
    response.headers.set('X-DNS-Prefetch-Control', 'on');
    response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('X-Frame-Options', 'DENY');
    response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

    return response;
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
