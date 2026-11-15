import { randomUUID } from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';
import type { DeviceDetails } from '@/lib/contract/v1';
import { prisma } from '@/lib/db';
import { hashSecretToken, newSecretToken } from '@/lib/secretTokens';
import { currentTokenVersion } from '@/lib/sessionVersion';

/**
 * Sign-in for the phone app (docs/mobile/ROADMAP.md, Phase 2).
 *
 * The website keeps its session in a cookie. A phone holds two tokens instead:
 *
 * - An access token, signed here and valid for 15 minutes, sent with every
 *   request. It carries the account's `tokenVersion`, and every check compares
 *   it, so "sign out of all devices" and a password reset end phone sessions the
 *   same way they end the website's (src/lib/sessionVersion.ts).
 * - A refresh token: random, valid for 60 days, kept by the server only as its
 *   SHA-256. Each use retires it and issues the next one in the same family. A
 *   retired one coming back means someone copied it, so the whole family is
 *   revoked and the phone signs in again. The exception is a few seconds after
 *   it was used: a phone that lost the answer to its refresh and asks again gets
 *   a fresh token rather than being signed out.
 */

export const ACCESS_TTL_SECONDS = 15 * 60;
export const REFRESH_TTL_MS = 60 * 24 * 60 * 60 * 1000;
/** How long a used refresh token may come back as an honest retry. */
export const RETRY_LEEWAY_MS = 30_000;

const ISSUER = 'splitit';
const AUDIENCE = 'splitit-app';

/** The server has no signing secret: phone sign-in is off, not broken. */
export class MobileAuthUnavailable extends Error {
    constructor() {
        super('Phone sign-in is not set up on this server (MOBILE_TOKEN_SECRET).');
    }
}

function signingKey(): Uint8Array {
    const secret = process.env.MOBILE_TOKEN_SECRET;
    if (!secret || secret.length < 32) throw new MobileAuthUnavailable();
    return new TextEncoder().encode(secret);
}

export interface TokenPair {
    accessToken: string;
    accessExpiresAt: string;
    refreshToken: string;
    refreshExpiresAt: string;
    deviceId: string;
}

async function accessToken(userId: string, tokenVersion: number, deviceId: string, now: Date) {
    const issuedAt = Math.floor(now.getTime() / 1000);
    const token = await new SignJWT({ tv: tokenVersion, dev: deviceId })
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .setSubject(userId)
        .setIssuer(ISSUER)
        .setAudience(AUDIENCE)
        .setIssuedAt(issuedAt)
        .setExpirationTime(issuedAt + ACCESS_TTL_SECONDS)
        .sign(signingKey());
    return { token, expiresAt: new Date((issuedAt + ACCESS_TTL_SECONDS) * 1000) };
}

async function issue(
    userId: string,
    tokenVersion: number,
    deviceId: string,
    familyId: string,
    now: Date,
): Promise<TokenPair> {
    const refreshToken = newSecretToken();
    const refreshExpiresAt = new Date(now.getTime() + REFRESH_TTL_MS);
    await prisma.refreshToken.create({
        data: { userId, deviceId, familyId, tokenHash: hashSecretToken(refreshToken), tokenVersion, expiresAt: refreshExpiresAt },
    });
    const access = await accessToken(userId, tokenVersion, deviceId, now);
    return {
        accessToken: access.token,
        accessExpiresAt: access.expiresAt.toISOString(),
        refreshToken,
        refreshExpiresAt: refreshExpiresAt.toISOString(),
        deviceId,
    };
}

/** A new session for an account that has just proved who it is. */
export async function startSession(userId: string, device: DeviceDetails, now = new Date()): Promise<TokenPair> {
    signingKey();
    const tokenVersion = (await currentTokenVersion(userId, { fresh: true })) ?? 0;
    const details = { platform: device.platform, name: device.name ?? null, appVersion: device.appVersion ?? null, lastSeenAt: now };

    // The phone's own device row if it still has one on this account; otherwise a new one.
    const known = device.deviceId ? await prisma.device.findFirst({ where: { id: device.deviceId, userId }, select: { id: true } }) : null;
    const row = known
        ? await prisma.device.update({ where: { id: known.id }, data: details, select: { id: true } })
        : await prisma.device.create({ data: { userId, ...details }, select: { id: true } });

    return issue(userId, tokenVersion, row.id, randomUUID(), now);
}

export type RefreshOutcome = { ok: true; tokens: TokenPair } | { ok: false; reason: 'invalid' | 'expired' | 'reused' | 'ended' };

/** Every token in a family stops working: a copy was detected, or the phone signed out. */
async function revokeFamily(familyId: string, now: Date) {
    await prisma.refreshToken.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: now } });
}

/** Trades a refresh token for a new pair. */
export async function rotateRefreshToken(refreshToken: string, now = new Date()): Promise<RefreshOutcome> {
    signingKey();
    const tokenHash = hashSecretToken(refreshToken);
    const stored = await prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (!stored) return { ok: false, reason: 'invalid' };
    if (stored.revokedAt) return { ok: false, reason: 'ended' };
    if (stored.expiresAt <= now) return { ok: false, reason: 'expired' };

    // Retire it, unless another request already has: only one use wins.
    const claimed = await prisma.refreshToken.updateMany({ where: { id: stored.id, usedAt: null, revokedAt: null }, data: { usedAt: now } });
    if (claimed.count === 0) {
        const again = await prisma.refreshToken.findUnique({ where: { id: stored.id }, select: { usedAt: true, revokedAt: true } });
        const retry = again?.usedAt && !again.revokedAt && now.getTime() - again.usedAt.getTime() <= RETRY_LEEWAY_MS;
        if (!retry) {
            await revokeFamily(stored.familyId, now);
            return { ok: false, reason: 'reused' };
        }
    }

    // "Sign out of all devices" or a password reset since it was issued; or the account is gone.
    const version = await currentTokenVersion(stored.userId, { fresh: true });
    if (version === null || version !== stored.tokenVersion) {
        await revokeFamily(stored.familyId, now);
        return { ok: false, reason: 'ended' };
    }
    if (!stored.deviceId) {
        await revokeFamily(stored.familyId, now);
        return { ok: false, reason: 'ended' };
    }

    await prisma.device.update({ where: { id: stored.deviceId }, data: { lastSeenAt: now } }).catch(() => undefined);
    return { ok: true, tokens: await issue(stored.userId, stored.tokenVersion, stored.deviceId, stored.familyId, now) };
}

/** Signs the phone out: its refresh token, and every one before or after it, stops working. */
export async function endSession(refreshToken: string, now = new Date()) {
    const stored = await prisma.refreshToken.findUnique({ where: { tokenHash: hashSecretToken(refreshToken) }, select: { familyId: true, deviceId: true } });
    if (!stored) return;
    await revokeFamily(stored.familyId, now);
    // A signed-out phone gets no more pushes.
    if (stored.deviceId) await prisma.device.update({ where: { id: stored.deviceId }, data: { pushToken: null } }).catch(() => undefined);
}

/**
 * Where this phone's pushes go. A token can belong to one device only: if
 * another account signed in on this phone before, it stops getting pushes
 * here. Null stops pushes to this phone.
 */
export async function setPushToken(caller: MobileCaller, token: string | null): Promise<{ turnedOn: boolean }> {
    return prisma.$transaction(async (tx) => {
        const before = await tx.device.findFirst({ where: { id: caller.deviceId, userId: caller.userId }, select: { pushToken: true } });
        if (token) await tx.device.updateMany({ where: { pushToken: token, NOT: { id: caller.deviceId } }, data: { pushToken: null } });
        await tx.device.update({ where: { id: caller.deviceId, userId: caller.userId }, data: { pushToken: token, lastSeenAt: new Date() } });
        // A token this phone didn't hold before: notifications were just turned on (or Firebase gave it a new one).
        return { turnedOn: Boolean(token) && before?.pushToken !== token };
    });
}

export interface MobileCaller {
    userId: string;
    deviceId: string;
}

/** The account an access token belongs to, or null if it is forged, expired or its session was ended. */
export async function verifyAccessToken(token: string): Promise<MobileCaller | null> {
    let key: Uint8Array;
    try {
        key = signingKey();
    } catch {
        return null;
    }
    try {
        const { payload } = await jwtVerify(token, key, { issuer: ISSUER, audience: AUDIENCE, algorithms: ['HS256'] });
        if (typeof payload.sub !== 'string' || typeof payload.tv !== 'number' || typeof payload.dev !== 'string') return null;
        const version = await currentTokenVersion(payload.sub);
        if (version === null || version !== payload.tv) return null;
        return { userId: payload.sub, deviceId: payload.dev };
    } catch {
        return null;
    }
}

/** The caller of a phone API request, from its `Authorization: Bearer` header. */
export async function mobileCaller(request: Request): Promise<MobileCaller | null> {
    const header = request.headers.get('authorization') ?? '';
    const match = /^Bearer\s+([A-Za-z0-9._-]{20,4096})$/.exec(header.trim());
    return match ? verifyAccessToken(match[1]) : null;
}
