/**
 * Which limit applies to a request.
 *
 * - `auth`: credential checks, registration and password-reset email, which
 *   brute-force and email-bombing attacks hit. The caller isn't signed in yet,
 *   so a browser counts as its device, and its network has a ceiling (B-025): a
 *   class signing up at once from one campus address is not one person. What
 *   stops guessing is per account (ten tries per quarter hour, lib/auth.ts);
 *   what stops inbox flooding is per address (lib/emailVerification.ts, the
 *   forgot-password route).
 * - `preview`: the settlement preview, which does real CPU work per request.
 * - `api`: everything else under /api, keyed by the verified user when signed in.
 *
 * Probes, scrapes and NextAuth's own session polling are never limited.
 * Limits are per minute and configurable per environment.
 *
 * Identity-keyed policies also carry a network ceiling. An anonymous device is
 * limited on its own so a classroom behind one NAT is not one person (B-015),
 * but device identities are free to mint, so the address they share keeps a
 * limit too. The defaults are sized for a demo of about a hundred phones on one
 * network, each planning a trip every few seconds, with room to spare.
 */

type PolicyName = 'auth' | 'preview' | 'api';

export interface RateLimitPolicy {
    name: PolicyName;
    limit: number;
    windowMs: number;
    keyBy: 'ip' | 'identity';
    /** The most a whole network address may send when its requests come from anonymous devices. */
    networkLimit?: number;
}

const MINUTE_MS = 60_000;

const UNLIMITED_PREFIXES = ['/api/health/', '/api/metrics'];

const CREDENTIAL_ROUTES = new Set([
    '/api/auth/callback/credentials',
    '/api/register',
    '/api/auth/forgot-password',
    '/api/auth/reset-password',
    '/api/auth/verify-email',
    '/api/auth/resend-verification',
]);

function perMinute(variable: string, fallback: number) {
    const value = Number(process.env[variable]);
    return Number.isInteger(value) && value > 0 ? value : fallback;
}

export function policyFor(method: string, pathname: string): RateLimitPolicy | null {
    if (!pathname.startsWith('/api/')) return null;
    if (UNLIMITED_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return null;

    if (method === 'POST' && CREDENTIAL_ROUTES.has(pathname)) {
        return {
            name: 'auth',
            limit: perMinute('RATE_LIMIT_AUTH_PER_MINUTE', 10),
            windowMs: MINUTE_MS,
            keyBy: 'identity',
            networkLimit: perMinute('RATE_LIMIT_AUTH_NETWORK_PER_MINUTE', 240),
        };
    }
    // Session, CSRF and provider lookups are polled by the NextAuth client itself.
    if (pathname.startsWith('/api/auth/')) return null;

    if (pathname === '/api/settlements/preview') {
        return {
            name: 'preview',
            limit: perMinute('RATE_LIMIT_PREVIEW_PER_MINUTE', 60),
            windowMs: MINUTE_MS,
            keyBy: 'identity',
            networkLimit: perMinute('RATE_LIMIT_PREVIEW_NETWORK_PER_MINUTE', 2_400),
        };
    }
    return {
        name: 'api',
        limit: perMinute('RATE_LIMIT_API_PER_MINUTE', 120),
        windowMs: MINUTE_MS,
        keyBy: 'identity',
        networkLimit: perMinute('RATE_LIMIT_API_NETWORK_PER_MINUTE', 3_600),
    };
}
