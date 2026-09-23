import { encode } from 'next-auth/jwt';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setRateLimitStore } from '@/lib/rateLimit';
import { clearIdentityCache } from '@/lib/rateLimit/identity';
import type { RateLimitStore } from '@/lib/rateLimit/store';
import { proxy } from '@/proxy';

/*
 * The page gate opens a signed-in page only for a session this server issued
 * that hasn't expired. A cookie with the right name used to be enough, so a
 * forged or expired one opened the page and every request on it then failed.
 */

const SECRET = 'test-secret-that-is-long-enough-for-hkdf-000000';
const COOKIE = 'authjs.session-token'; // the development name (NODE_ENV is "test")
const allowAll: RateLimitStore = { backend: 'redis', hit: async () => ({ allowed: true, count: 1, resetMs: 60_000 }), warm: async () => {}, close: async () => {} };

const session = (options: { secret?: string; maxAge?: number } = {}) =>
    encode({ token: { id: 'cuseralice00001', email: 'alice@example.com' }, secret: options.secret ?? SECRET, salt: COOKIE, maxAge: options.maxAge ?? 3_600 });

const visit = (path: string, cookie?: string) =>
    proxy(new NextRequest(`http://localhost${path}`, { headers: cookie ? { cookie } : {} }));

describe('the page gate', () => {
    beforeEach(async () => {
        vi.stubEnv('AUTH_SECRET', SECRET);
        clearIdentityCache();
        await setRateLimitStore(allowAll);
        vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
        vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    });
    afterEach(async () => {
        await setRateLimitStore(undefined);
        vi.restoreAllMocks();
        vi.unstubAllEnvs();
    });

    it('opens a signed-in page for a genuine session', async () => {
        const res = await visit('/dashboard', `${COOKIE}=${await session()}`);

        expect(res.headers.get('location')).toBeNull();
        expect(res.headers.get('x-middleware-next')).toBe('1');
        expect(res.cookies.get(COOKIE)).toBeUndefined();
    });

    it.each([
        ['a forged cookie', async () => 'anything'],
        ['an expired session', () => session({ maxAge: -60 })],
        ['a session another server issued', () => session({ secret: 'another-secret-that-is-long-enough-for-hkdf-00' })],
    ])('sends %s to sign in, and drops the cookie', async (_, value) => {
        const res = await visit('/groups/cgroup0000001', `${COOKIE}=${await value()}; theme=dark`);

        expect(res.status).toBe(307);
        expect(res.headers.get('location')).toBe('http://localhost/login?callbackUrl=%2Fgroups%2Fcgroup0000001');
        expect(res.cookies.get(COOKIE)).toMatchObject({ value: '', maxAge: 0, path: '/', httpOnly: true, sameSite: 'lax' });
        expect(res.cookies.get('theme')).toBeUndefined();
    });

    it('guards the history and admin pages too', async () => {
        for (const path of ['/history', '/admin/health']) {
            expect((await visit(path)).headers.get('location')).toBe(`http://localhost/login?callbackUrl=${encodeURIComponent(path)}`);
        }
    });

    it('sends a genuine session away from sign-in, to the dashboard', async () => {
        const res = await visit('/login', `${COOKIE}=${await session()}`);
        expect(res.headers.get('location')).toBe('http://localhost/dashboard');
    });

    it('shows sign-in to a dead session and drops its cookie, without a redirect that could loop', async () => {
        const res = await visit('/login', `${COOKIE}=anything`);

        expect(res.headers.get('location')).toBeNull();
        expect(res.headers.get('x-middleware-next')).toBe('1');
        expect(res.cookies.get(COOKIE)).toMatchObject({ value: '', maxAge: 0 });
    });

    it('counts a large session split across cookies, as Auth.js stores one', async () => {
        const token = await session();
        const half = Math.ceil(token.length / 2);

        const res = await visit('/dashboard', `${COOKIE}.0=${token.slice(0, half)}; ${COOKIE}.1=${token.slice(half)}`);

        expect(res.headers.get('location')).toBeNull();
        expect(res.cookies.get(`${COOKIE}.0`)).toBeUndefined();
    });

    it('drops every piece of a dead session, and a __Secure- one as Secure', async () => {
        const res = await visit('/dashboard', `${COOKIE}.0=aaa; ${COOKIE}.1=bbb; __Secure-${COOKIE}=ccc`);

        expect(res.cookies.get(`${COOKIE}.0`)).toMatchObject({ maxAge: 0, secure: false });
        expect(res.cookies.get(`${COOKIE}.1`)).toMatchObject({ maxAge: 0, secure: false });
        expect(res.cookies.get(`__Secure-${COOKIE}`)).toMatchObject({ maxAge: 0, secure: true });
    });

    it('without an auth secret, where nothing can be checked, a cookie still counts', async () => {
        vi.stubEnv('AUTH_SECRET', '');
        vi.stubEnv('NEXTAUTH_SECRET', '');

        expect((await visit('/dashboard', `${COOKIE}=anything`)).headers.get('location')).toBeNull();
        expect((await visit('/login', `${COOKIE}=anything`)).headers.get('location')).toBe('http://localhost/dashboard');
    });

    it('leaves API routes to their own checks', async () => {
        const res = await visit('/api/groups', `${COOKIE}=anything`);

        expect(res.headers.get('location')).toBeNull();
        expect(res.cookies.get(COOKIE)).toBeUndefined();
    });
});
