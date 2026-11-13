import bcrypt from 'bcryptjs';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBody, MeAnswer, Refreshed, Session } from '@/lib/contract/v1';
import { prisma } from '@/lib/db';
import { hashSecretToken } from '@/lib/secretTokens';
import { forgetTokenVersion } from '@/lib/sessionVersion';
import { emptyDatabase, person } from './fixtures';

// The password route reaches next-auth's module, which needs Next's server runtime.
vi.mock('next-auth', () => ({
    default: () => ({ handlers: {}, signIn: vi.fn(), signOut: vi.fn(), auth: vi.fn() }),
    CredentialsSignin: class CredentialsSignin extends Error {},
}));
vi.mock('next-auth/providers/credentials', () => ({ default: (options: unknown) => options }));
vi.mock('next-auth/providers/google', () => ({ default: (options: unknown) => options }));
vi.mock('next-auth/providers/github', () => ({ default: (options: unknown) => options }));

const { endSession, rotateRefreshToken, startSession, verifyAccessToken, RETRY_LEEWAY_MS, REFRESH_TTL_MS } = await import('@/lib/mobileAuth');
const passwordRoute = await import('@/app/api/v1/auth/password/route');
const refreshRoute = await import('@/app/api/v1/auth/refresh/route');
const signOutRoute = await import('@/app/api/v1/auth/sign-out/route');
const meRoute = await import('@/app/api/v1/me/route');

const PHONE = { platform: 'android' as const, name: 'Galaxy', appVersion: '0.1.0' };

beforeAll(() => {
    process.env.MOBILE_TOKEN_SECRET = 'a-database-test-secret-of-32-characters-or-more';
});
beforeEach(emptyDatabase);
afterAll(() => prisma.$disconnect());

const post = (body: unknown) => new Request('https://splitit.test/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('a phone session', () => {
    it('starts with a device, a refresh token kept only as a hash, and an access token for the account', async () => {
        const alice = await person('Alice');
        const tokens = await startSession(alice.id, PHONE);

        const stored = await prisma.refreshToken.findMany({ where: { userId: alice.id } });
        expect(stored).toHaveLength(1);
        expect(stored[0].tokenHash).toBe(hashSecretToken(tokens.refreshToken));
        expect(stored[0].tokenHash).not.toContain(tokens.refreshToken);
        expect(await prisma.device.findUniqueOrThrow({ where: { id: tokens.deviceId } })).toMatchObject({ userId: alice.id, platform: 'android', name: 'Galaxy' });
        expect(await verifyAccessToken(tokens.accessToken)).toEqual({ userId: alice.id, deviceId: tokens.deviceId });
    });

    it('keeps one device row when the phone signs in again, but never takes another account’s', async () => {
        const alice = await person('Alice');
        const bob = await person('Bob');
        const first = await startSession(alice.id, PHONE);
        const again = await startSession(alice.id, { ...PHONE, deviceId: first.deviceId });
        expect(again.deviceId).toBe(first.deviceId);
        const bobs = await startSession(bob.id, { ...PHONE, deviceId: first.deviceId });
        expect(bobs.deviceId).not.toBe(first.deviceId);
        expect(await prisma.device.count()).toBe(2);
    });
});

describe('refreshing', () => {
    it('trades a token for a new pair, once', async () => {
        const alice = await person('Alice');
        const first = await startSession(alice.id, PHONE);
        const now = new Date();
        const next = await rotateRefreshToken(first.refreshToken, now);
        expect(next.ok).toBe(true);
        if (!next.ok) return;
        expect(next.tokens.refreshToken).not.toBe(first.refreshToken);
        expect(next.tokens.deviceId).toBe(first.deviceId);
        expect(await verifyAccessToken(next.tokens.accessToken)).toEqual({ userId: alice.id, deviceId: first.deviceId });
        const third = await rotateRefreshToken(next.tokens.refreshToken, new Date(now.getTime() + 1000));
        expect(third.ok).toBe(true);
    });

    it('revokes the whole family when a used token comes back later: a copy', async () => {
        const alice = await person('Alice');
        const first = await startSession(alice.id, PHONE);
        const now = new Date();
        const next = await rotateRefreshToken(first.refreshToken, now);
        if (!next.ok) throw new Error('first refresh failed');

        const copy = await rotateRefreshToken(first.refreshToken, new Date(now.getTime() + RETRY_LEEWAY_MS + 1000));
        expect(copy).toEqual({ ok: false, reason: 'reused' });
        // The honest phone's newer token dies with it: both have to sign in again.
        expect(await rotateRefreshToken(next.tokens.refreshToken, new Date(now.getTime() + RETRY_LEEWAY_MS + 2000))).toEqual({ ok: false, reason: 'ended' });
    });

    it('treats the same token again within seconds as a retry, not a copy', async () => {
        const alice = await person('Alice');
        const first = await startSession(alice.id, PHONE);
        const now = new Date();
        const answered = await rotateRefreshToken(first.refreshToken, now);
        const retried = await rotateRefreshToken(first.refreshToken, new Date(now.getTime() + 5000));
        expect(answered.ok && retried.ok).toBe(true);
        if (!answered.ok) return;
        expect((await rotateRefreshToken(answered.tokens.refreshToken, new Date(now.getTime() + 6000))).ok).toBe(true);
    });

    it('refuses an expired token and an unknown one', async () => {
        const alice = await person('Alice');
        const first = await startSession(alice.id, PHONE);
        expect(await rotateRefreshToken(first.refreshToken, new Date(Date.now() + REFRESH_TTL_MS + 1000))).toEqual({ ok: false, reason: 'expired' });
        expect(await rotateRefreshToken('a-token-this-server-never-issued-at-all')).toEqual({ ok: false, reason: 'invalid' });
    });

    it('ends when the account signs out everywhere, for refresh and access tokens alike', async () => {
        const alice = await person('Alice');
        const first = await startSession(alice.id, PHONE);
        await prisma.user.update({ where: { id: alice.id }, data: { tokenVersion: { increment: 1 } } });
        forgetTokenVersion(alice.id);
        expect(await verifyAccessToken(first.accessToken)).toBeNull();
        expect(await rotateRefreshToken(first.refreshToken)).toEqual({ ok: false, reason: 'ended' });
    });

    it('ends when the phone signs out, for every token in its family', async () => {
        const alice = await person('Alice');
        const first = await startSession(alice.id, PHONE);
        const next = await rotateRefreshToken(first.refreshToken);
        if (!next.ok) throw new Error('refresh failed');
        await endSession(next.tokens.refreshToken);
        expect(await rotateRefreshToken(next.tokens.refreshToken)).toEqual({ ok: false, reason: 'ended' });
        expect(await prisma.refreshToken.count({ where: { revokedAt: null } })).toBe(0);
    });
});

describe('the routes, end to end', () => {
    it('signs in with a password, reads the account, refreshes and signs out', async () => {
        const password = 'a-long-enough-password';
        const alice = await prisma.user.create({
            data: { name: 'Alice', email: 'alice@example.test', password: await bcrypt.hash(password, 4), emailVerified: new Date() },
        });

        const wrong = await passwordRoute.POST(post({ email: 'alice@example.test', password: 'nope', device: PHONE }));
        expect(wrong.status).toBe(401);
        expect(ErrorBody.parse(await wrong.json())).toMatchObject({ code: 'bad_credentials' });

        const signedIn = await passwordRoute.POST(post({ email: 'ALICE@example.test', password, device: PHONE }));
        expect(signedIn.status).toBe(200);
        // Every answer is checked against the contract the app reads.
        const session = Session.parse(await signedIn.json());
        expect(session.me).toMatchObject({ id: alice.id, email: 'alice@example.test' });

        const me = await meRoute.GET(new Request('https://splitit.test/api/v1/me', { headers: { authorization: `Bearer ${session.tokens.accessToken}` } }));
        expect(me.status).toBe(200);
        expect(MeAnswer.parse(await me.json()).me.id).toBe(alice.id);
        expect((await meRoute.GET(new Request('https://splitit.test/api/v1/me'))).status).toBe(401);

        const refreshed = await refreshRoute.POST(post({ refreshToken: session.tokens.refreshToken }));
        expect(refreshed.status).toBe(200);
        const { tokens } = Refreshed.parse(await refreshed.json());

        expect((await signOutRoute.POST(post({ refreshToken: tokens.refreshToken }))).status).toBe(204);
        const after = await refreshRoute.POST(post({ refreshToken: tokens.refreshToken }));
        expect(after.status).toBe(401);
        expect(ErrorBody.parse(await after.json())).toMatchObject({ code: 'ended' });
    });

    it('says what was wrong with a malformed request', async () => {
        const response = await passwordRoute.POST(post({ email: 'a@b.test', password: 'x', device: { platform: 'windows' } }));
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ code: 'invalid_input' });
    });
});
