import { prisma } from '@/lib/db';

/**
 * Ending sessions that live in the browser.
 *
 * A session is a signed cookie (a JWT), so the server can't delete it. Instead
 * each one carries the account's `tokenVersion` from when it was issued, and a
 * session carrying an older version is refused. A password reset, or "sign out
 * of all devices", raises the version: every session issued before it ends.
 *
 * Every request that reads the session would read the version too, so a
 * process trusts what it read for 30 seconds. An ended session therefore stops
 * working at once on the server that ended it, and within 30 seconds on every
 * other.
 */

export const TRUST_VERSION_FOR_MS = 30_000;
const MAX_REMEMBERED = 5_000;

const remembered = new Map<string, { version: number | null; readAt: number }>();

/**
 * The account's current version, or null if there is no such account.
 * `fresh` skips what this process remembers: a session being issued must carry
 * the version as it is now, or it could be refused as soon as the memory expires.
 */
export async function currentTokenVersion(userId: string, options: { fresh?: boolean; now?: number } = {}): Promise<number | null> {
    const now = options.now ?? Date.now();
    const hit = remembered.get(userId);
    if (!options.fresh && hit && now - hit.readAt < TRUST_VERSION_FOR_MS) return hit.version;

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { tokenVersion: true } });
    const version = user ? user.tokenVersion : null;
    if (remembered.size >= MAX_REMEMBERED) remembered.clear();
    remembered.set(userId, { version, readAt: now });
    return version;
}

/** Drops what this process remembers about an account, after its version was raised. */
export function forgetTokenVersion(userId: string) {
    remembered.delete(userId);
}

/** For tests. */
export function forgetAllTokenVersions() {
    remembered.clear();
}
