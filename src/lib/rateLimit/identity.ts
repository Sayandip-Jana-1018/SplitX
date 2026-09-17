import { createHash } from 'node:crypto';
import { getToken } from 'next-auth/jwt';
import { ipBucket } from './clientIp';
import { DEVICE_COOKIE, readCookie, verifyDevice } from './device';

/**
 * Who a request counts against.
 *
 * Signed-in requests count against the user — the session token is decrypted
 * and verified with the auth secret, so a forged or random cookie is simply
 * not a session and falls back to the IP. That also means everyone behind one
 * NAT (a campus network, an office) is limited individually once signed in.
 *
 * Anonymous requests that carry a genuine device cookie count against that
 * device, and ALSO against their network, which has a higher ceiling of its
 * own (B-015). Anything else counts against the network address.
 *
 * Keys hold a hash of the identifier, never an email or user ID.
 */

export interface RequestIdentity {
    kind: 'user' | 'device' | 'ip' | 'unknown';
    key: string;
    /** For an anonymous device: the network it shares, which is limited too. */
    network?: RequestIdentity;
}

const digest = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 32);

export function ipIdentity(ip: string | null): RequestIdentity {
    return ip ? { kind: 'ip', key: `ip:${digest(ipBucket(ip))}` } : { kind: 'unknown', key: 'ip:unknown' };
}

// Verifying a token costs ~0.3 ms and runs on every API call, while one browser
// sends the same cookie over and over. Results are cached briefly by a hash of
// the cookie header. This can't outlive a session: JWT sessions are not
// revocable before expiry, and no entry outlives its token's exp.
const CACHE_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 5_000;
const verified = new Map<string, { userId: string | null; expiresAt: number }>();

function remember(key: string, userId: string | null, expiresAt: number) {
    verified.delete(key);
    verified.set(key, { userId, expiresAt });
    if (verified.size > CACHE_MAX_ENTRIES) verified.delete(verified.keys().next().value as string);
}

async function verifiedUserId(request: Request): Promise<string | null> {
    const cookies = request.headers.get('cookie');
    const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
    if (!cookies || !cookies.includes('authjs.session-token') || !secret) return null;

    const cacheKey = digest(cookies);
    const cached = verified.get(cacheKey);
    const now = Date.now();
    if (cached && cached.expiresAt > now) return cached.userId;

    try {
        const token = await getToken({
            req: request,
            secret,
            // Mirrors the cookie naming in lib/auth.ts.
            secureCookie: process.env.NODE_ENV === 'production',
        });
        const id = token?.id ?? token?.sub ?? token?.email;
        const userId = typeof id === 'string' && id ? id : null;
        const tokenExpiry = typeof token?.exp === 'number' ? token.exp * 1000 : Infinity;
        remember(cacheKey, userId, Math.min(now + CACHE_TTL_MS, tokenExpiry));
        return userId;
    } catch {
        return null;
    }
}

export async function resolveIdentity(request: Request, ip: string | null): Promise<RequestIdentity> {
    const userId = await verifiedUserId(request);
    if (userId) return { kind: 'user', key: `user:${digest(userId)}` };

    const network = ipIdentity(ip);
    const deviceId = verifyDevice(readCookie(request.headers.get('cookie'), DEVICE_COOKIE));
    return deviceId ? { kind: 'device', key: `device:${digest(deviceId)}`, network } : network;
}

/** Test hook: forget cached verifications. */
export function clearIdentityCache() {
    verified.clear();
}
