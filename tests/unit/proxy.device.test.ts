import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setRateLimitStore } from '@/lib/rateLimit';
import { DEVICE_COOKIE, mintDevice, verifyDevice } from '@/lib/rateLimit/device';
import type { RateLimitStore } from '@/lib/rateLimit/store';
import { proxy } from '@/proxy';

const SECRET = 'test-secret-that-is-long-enough-for-hkdf-000000';
const allowAll: RateLimitStore = { backend: 'redis', hit: async () => ({ allowed: true, count: 1, resetMs: 60_000 }), warm: async () => {}, close: async () => {} };
const denyAll: RateLimitStore = { backend: 'redis', hit: async () => ({ allowed: false, count: 60, resetMs: 60_000 }), warm: async () => {}, close: async () => {} };

const visit = (path: string, headers: Record<string, string> = {}, method = 'GET') =>
    proxy(new NextRequest(`http://localhost${path}`, { method, headers: { 'x-forwarded-for': '203.0.113.50', ...headers } }));

describe('proxy device cookies (B-015)', () => {
    beforeEach(async () => {
        vi.stubEnv('AUTH_SECRET', SECRET);
        await setRateLimitStore(allowAll);
        vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
        vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    });
    afterEach(async () => {
        await setRateLimitStore(undefined);
        vi.restoreAllMocks();
        vi.unstubAllEnvs();
    });

    it('gives an anonymous page visit a genuine device cookie, HttpOnly and SameSite=Lax', async () => {
        const res = await visit('/scale');
        const cookie = res.cookies.get(DEVICE_COOKIE);

        expect(verifyDevice(cookie?.value)).not.toBeNull();
        const header = res.headers.get('set-cookie') ?? '';
        expect(header).toMatch(/HttpOnly/i);
        expect(header).toMatch(/SameSite=lax/i);
        expect(header).toMatch(/Path=\//);
        expect(header).toMatch(/Max-Age=2592000/);
        expect(header).not.toMatch(/Secure/i);
    });

    it('marks the cookie Secure when the visitor connected over HTTPS', async () => {
        const res = await visit('/scale', { 'x-forwarded-proto': 'https' });
        expect(res.headers.get('set-cookie')).toMatch(/Secure/i);
    });

    it('sets it on API responses too, including a refusal, so the next request counts as this device', async () => {
        await setRateLimitStore(denyAll);
        const res = await visit('/api/settlements/preview', {}, 'POST');

        expect(res.status).toBe(429);
        expect(verifyDevice(res.cookies.get(DEVICE_COOKIE)?.value)).not.toBeNull();
    });

    it('leaves a genuine cookie alone', async () => {
        const res = await visit('/scale', { cookie: `${DEVICE_COOKIE}=${mintDevice()}` });
        expect(res.cookies.get(DEVICE_COOKIE)).toBeUndefined();
    });

    it('replaces a forged or altered cookie with a genuine one', async () => {
        const res = await visit('/scale', { cookie: `${DEVICE_COOKIE}=AAAAAAAAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAA` });
        expect(verifyDevice(res.cookies.get(DEVICE_COOKIE)?.value)).not.toBeNull();
    });

    it('gives a signed-in visitor none: they are limited by account', async () => {
        const res = await visit('/scale', { cookie: 'authjs.session-token=anything' });
        expect(res.cookies.get(DEVICE_COOKIE)).toBeUndefined();
    });

    it('sets nothing when no auth secret is configured', async () => {
        vi.stubEnv('AUTH_SECRET', '');
        vi.stubEnv('NEXTAUTH_SECRET', '');
        const res = await visit('/scale');
        expect(res.cookies.get(DEVICE_COOKIE)).toBeUndefined();
    });
});
