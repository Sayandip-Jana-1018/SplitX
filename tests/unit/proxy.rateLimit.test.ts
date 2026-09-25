import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { metrics } from '@/lib/metrics';
import { setRateLimitStore } from '@/lib/rateLimit';
import { DEVICE_COOKIE, mintDevice } from '@/lib/rateLimit/device';
import { clearLocalLimits } from '@/lib/rateLimit/local';
import type { RateLimitStore } from '@/lib/rateLimit/store';
import { proxy } from '@/proxy';

const store = (hit: RateLimitStore['hit']): RateLimitStore => ({ backend: 'redis', hit, warm: async () => {}, close: async () => {} });
const api = (path = '/api/groups') => new NextRequest(`http://localhost${path}`, { headers: { 'x-forwarded-for': '198.51.100.7' } });

async function decisions(decision: string) {
    const { values } = await metrics.proxyDecisions.get();
    return values.find((v) => v.labels.decision === decision)?.value ?? 0;
}

describe('proxy rate limiting', () => {
    beforeEach(() => {
        metrics.proxyDecisions.reset();
        metrics.httpRequestsTotal.reset();
        vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
        vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    });
    afterEach(async () => {
        await setRateLimitStore(undefined);
        vi.restoreAllMocks();
    });

    it('answers 429 with Retry-After, the limit headers and the request ID', async () => {
        await setRateLimitStore(store(async () => ({ allowed: false, count: 120, resetMs: 42_300 })));
        const res = await proxy(api());

        expect(res.status).toBe(429);
        expect(res.headers.get('retry-after')).toBe('43');
        expect(res.headers.get('x-ratelimit-limit')).toBe('120');
        expect(res.headers.get('x-ratelimit-remaining')).toBe('0');
        const body = await res.json();
        expect(body).toMatchObject({ code: 'RATE_LIMITED', requestId: res.headers.get('x-request-id') });
        expect(await decisions('rate_limited')).toBe(1);
    });

    it('forwards allowed requests with remaining capacity', async () => {
        await setRateLimitStore(store(async () => ({ allowed: true, count: 20, resetMs: 30_000 })));
        const res = await proxy(api());

        expect(res.headers.get('x-middleware-next')).toBe('1');
        expect(res.headers.get('x-ratelimit-remaining')).toBe('100');
        expect(await decisions('pass')).toBe(1);
    });

    describe('sign-in and sign-up without the shared limiter', () => {
        // Found by the browser tests (D-107): this fallback counted every credential
        // request against its network address, so a room signing up from one campus
        // address was one person again, ten a minute, whenever Redis was missing or down.
        const signUp = (device?: string) => new NextRequest('http://localhost/api/register', {
            method: 'POST',
            headers: { 'x-forwarded-for': '198.51.100.7', ...(device ? { cookie: `${DEVICE_COOKIE}=${device}` } : {}) },
        });

        beforeEach(async () => {
            vi.stubEnv('AUTH_SECRET', 'a-test-secret-that-signs-device-cookies');
            clearLocalLimits();
            await setRateLimitStore(null);
        });
        afterEach(() => vi.unstubAllEnvs());

        it('counts each phone on its own, as the shared limiter does', async () => {
            for (let i = 0; i < 25; i++) {
                expect((await proxy(signUp(mintDevice() ?? undefined))).status, `phone ${i + 1}`).not.toBe(429);
            }
        });

        it('still stops one phone at its limit of ten a minute', async () => {
            const phone = mintDevice() ?? undefined;
            for (let i = 0; i < 10; i++) expect((await proxy(signUp(phone))).status).not.toBe(429);
            const refused = await proxy(signUp(phone));
            expect(refused.status).toBe(429);
            expect(await refused.json()).toMatchObject({ code: 'RATE_LIMITED', error: 'Too many requests. Please wait a moment.' });
        });

        it('keeps the network\'s ceiling, since new device cookies cost nothing to make', async () => {
            vi.stubEnv('RATE_LIMIT_AUTH_NETWORK_PER_MINUTE', '3');
            for (let i = 0; i < 3; i++) expect((await proxy(signUp(mintDevice() ?? undefined))).status).not.toBe(429);
            expect((await proxy(signUp(mintDevice() ?? undefined))).status).toBe(429);
        });

        it('limits a request without a device by its address, as before', async () => {
            for (let i = 0; i < 10; i++) expect((await proxy(signUp())).status).not.toBe(429);
            expect((await proxy(signUp())).status).toBe(429);
        });
    });

    it('lets requests through when the limiter backend is down, and counts it', async () => {
        await setRateLimitStore(store(async () => {
            throw new Error('ECONNREFUSED');
        }));
        const res = await proxy(api());

        expect(res.status).toBe(200);
        expect(res.headers.get('x-middleware-next')).toBe('1');
        expect(await decisions('limiter_error')).toBe(1);
        // Forwarded, so the route span counts the response — the proxy must not count it too.
        expect((await metrics.httpRequestsTotal.get()).values).toHaveLength(0);
    });

    it('does not rate limit health probes even when the limiter would deny', async () => {
        const hit = vi.fn(async () => ({ allowed: false, count: 999, resetMs: 1 }));
        await setRateLimitStore(store(hit));
        const res = await proxy(api('/api/health/ready'));

        expect(res.status).toBe(200);
        expect(hit).not.toHaveBeenCalled();
    });
});
