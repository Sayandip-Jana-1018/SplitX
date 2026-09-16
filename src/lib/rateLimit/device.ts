import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * An anonymous device identity, for rate limiting only (B-015).
 *
 * A classroom on campus Wi-Fi reaches the internet through one address, so a
 * limit keyed by address makes eighty students share one person's allowance —
 * measured on the cluster, 93% of their requests were refused. Browsers keep
 * cookies, so each one is given a random identifier, signed with a key derived
 * from the auth secret, and limited on its own.
 *
 * What it is not: a security boundary. Anyone can mint as many identities as
 * they like by discarding the cookie and loading a page. That is why a device
 * identity never replaces the network limit — it is checked in addition to a
 * ceiling on the address it comes from (see checkRateLimit). The device limit
 * is about fairness inside a network; the network ceiling bounds what any one
 * source can take.
 *
 * Privacy: the identifier is random, tied to no account, HttpOnly, and only
 * its hash reaches Redis, where limiter keys expire after two windows.
 */

export const DEVICE_COOKIE = 'sx_device';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const ID_BYTES = 16;
const MAC_BYTES = 16;
// 16 bytes in unpadded base64url: exactly 22 characters.
const PART = /^[A-Za-z0-9_-]{22}$/;

let cachedKey: { secret: string; key: Buffer } | null = null;

function signingKey(): Buffer | null {
    const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
    if (!secret) return null;
    if (cachedKey?.secret !== secret) {
        // A key of its own, derived with a label, so a device signature can never
        // stand in for anything signed for sessions, and vice versa.
        cachedKey = { secret, key: createHmac('sha256', secret).update('splitx rate-limit device identity v1').digest() };
    }
    return cachedKey.key;
}

const mac = (id: string, key: Buffer) => createHmac('sha256', key).update(id).digest().subarray(0, MAC_BYTES);

/** A new signed device cookie value, or null when no auth secret is configured. */
export function mintDevice(): string | null {
    const key = signingKey();
    if (!key) return null;
    const id = randomBytes(ID_BYTES).toString('base64url');
    return `${id}.${mac(id, key).toString('base64url')}`;
}

/** The identifier inside a genuine device cookie; null for anything forged, altered or malformed. */
export function verifyDevice(value: string | null | undefined): string | null {
    if (!value) return null;
    const key = signingKey();
    if (!key) return null;
    const [id, signature, extra] = value.split('.');
    if (extra !== undefined || !id || !signature || !PART.test(id) || !PART.test(signature)) return null;
    // Compared as text, not as decoded bytes: 16 bytes in base64url leave four
    // unused bits in the last character, so several strings decode to the same
    // signature. Only the one canonical encoding is accepted.
    const expected = Buffer.from(mac(id, key).toString('base64url'));
    const given = Buffer.from(signature);
    return given.length === expected.length && timingSafeEqual(given, expected) ? id : null;
}

/** Reads one cookie from a Cookie header without allocating a map of all of them. */
export function readCookie(header: string | null, name: string): string | null {
    if (!header) return null;
    for (const part of header.split(';')) {
        const eq = part.indexOf('=');
        if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
    }
    return null;
}

export function deviceCookieOptions(secure: boolean) {
    return { httpOnly: true, sameSite: 'lax' as const, secure, path: '/', maxAge: MAX_AGE_SECONDS };
}
