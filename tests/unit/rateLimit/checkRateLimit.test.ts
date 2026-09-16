import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { metrics } from '@/lib/metrics';
import { checkRateLimit, setRateLimitStore } from '@/lib/rateLimit';
import { mintDevice } from '@/lib/rateLimit/device';
import type { HitResult, RateLimitStore } from '@/lib/rateLimit/store';

function fakeStore(behaviour: (key: string, limit: number) => Promise<HitResult>) {
    const calls: { key: string; limit: number; windowMs: number }[] = [];
    const store: RateLimitStore = {
        backend: 'redis',
        hit: vi.fn(async (key, limit, windowMs) => {
            calls.push({ key, limit, windowMs });
            return behaviour(key, limit);
        }),
        warm: vi.fn(async () => {}),
        close: vi.fn(async () => {}),
    };
    return { store, calls };
}

const req = (path: string, method = 'GET', xff = '198.51.100.7') =>
    new NextRequest(`http://localhost${path}`, { method, headers: { 'x-forwarded-for': xff } });

async function checks(policy: string, outcome: string) {
    const { values } = await metrics.rateLimitChecks.get();
    return values.find((v) => v.labels.policy === policy && v.labels.outcome === outcome)?.value ?? 0;
}

describe('checkRateLimit', () => {
    beforeEach(() => {
        metrics.rateLimitChecks.reset();
        vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    });
    afterEach(async () => {
        await setRateLimitStore(undefined);
        vi.restoreAllMocks();
        vi.unstubAllEnvs();
    });

    it('skips requests no policy covers without touching the backend', async () => {
        const { store } = fakeStore(async () => ({ allowed: true, count: 1, resetMs: 1 }));
        await setRateLimitStore(store);

        expect(await checkRateLimit(req('/api/health/live'))).toEqual({ outcome: 'skip' });
        expect(store.hit).not.toHaveBeenCalled();
    });

    it('allows under the limit and reports remaining capacity', async () => {
        const { store, calls } = fakeStore(async () => ({ allowed: true, count: 31, resetMs: 12_000 }));
        await setRateLimitStore(store);

        const result = await checkRateLimit(req('/api/groups'));
        expect(result).toMatchObject({ outcome: 'allow', limit: 120, remaining: 89, resetMs: 12_000 });
        expect(calls[0].key).toMatch(/^api:ip:[0-9a-f]{32}$/);
        expect(await checks('api', 'allow')).toBe(1);
    });

    it('denies over the limit', async () => {
        const { store } = fakeStore(async () => ({ allowed: false, count: 120, resetMs: 4_000 }));
        await setRateLimitStore(store);

        expect(await checkRateLimit(req('/api/groups'))).toMatchObject({ outcome: 'deny', remaining: 0 });
        expect(await checks('api', 'deny')).toBe(1);
    });

    it('fails open when the backend errors', async () => {
        const { store } = fakeStore(async () => {
            throw new Error('ECONNREFUSED');
        });
        await setRateLimitStore(store);

        const result = await checkRateLimit(req('/api/groups'));
        expect(result.outcome).toBe('error');
        expect(await checks('api', 'error')).toBe(1);
    });

    it('fails open when the backend is slower than RATE_LIMIT_TIMEOUT_MS', async () => {
        vi.stubEnv('RATE_LIMIT_TIMEOUT_MS', '50');
        const { store } = fakeStore(() => new Promise(() => {}));
        await setRateLimitStore(store);

        const started = performance.now();
        expect((await checkRateLimit(req('/api/groups'))).outcome).toBe('error');
        expect(performance.now() - started).toBeLessThan(1_000);
    });

    it('reports disabled — not allowed — when no backend is configured', async () => {
        await setRateLimitStore(null);
        expect(await checkRateLimit(req('/api/groups'))).toMatchObject({ outcome: 'disabled', policy: { name: 'api' } });
    });

    it('keys login attempts by IP even for a request carrying a session', async () => {
        const { store, calls } = fakeStore(async () => ({ allowed: true, count: 1, resetMs: 1 }));
        await setRateLimitStore(store);

        await checkRateLimit(req('/api/auth/callback/credentials', 'POST'));
        expect(calls[0]).toMatchObject({ limit: 10 });
        expect(calls[0].key).toMatch(/^auth:ip:/);
    });

    it('buckets by the proxy-recorded address, so a forged X-Forwarded-For prefix changes nothing', async () => {
        const { store, calls } = fakeStore(async () => ({ allowed: true, count: 1, resetMs: 1 }));
        await setRateLimitStore(store);

        await checkRateLimit(req('/api/groups', 'GET', '1.1.1.1, 198.51.100.7'));
        await checkRateLimit(req('/api/groups', 'GET', '9.9.9.9, 198.51.100.7'));
        expect(calls[0].key).toBe(calls[1].key);
    });
});

describe('checkRateLimit for anonymous devices (B-015)', () => {
    const SECRET = 'test-secret-that-is-long-enough-for-hkdf-000000';
    const fromDevice = (path: string, cookie: string, xff = '203.0.113.50') =>
        new NextRequest(`http://localhost${path}`, { method: 'POST', headers: { 'x-forwarded-for': xff, cookie } });

    beforeEach(() => {
        metrics.rateLimitChecks.reset();
        vi.stubEnv('AUTH_SECRET', SECRET);
        vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    });
    afterEach(async () => {
        await setRateLimitStore(undefined);
        vi.restoreAllMocks();
        vi.unstubAllEnvs();
    });

    it('checks the device against its own limit, then its network against the network ceiling', async () => {
        const { store, calls } = fakeStore(async () => ({ allowed: true, count: 5, resetMs: 30_000 }));
        await setRateLimitStore(store);

        const result = await checkRateLimit(fromDevice('/api/settlements/preview', 'sx_device=' + mintDevice()));

        expect(calls).toHaveLength(2);
        expect(calls[0]).toMatchObject({ limit: 60 });
        expect(calls[0].key).toMatch(/^preview:device:[0-9a-f]{32}$/);
        expect(calls[1]).toMatchObject({ limit: 2_400 });
        expect(calls[1].key).toMatch(/^preview:net:ip:[0-9a-f]{32}$/);
        expect(result).toMatchObject({ outcome: 'allow', scope: 'identity', limit: 60, remaining: 55 });
        expect(await checks('preview', 'allow')).toBe(1);
        expect(await checks('preview_network', 'allow')).toBe(1);
    });

    it('refuses the whole network once its ceiling is reached, even for a device under its own limit', async () => {
        const { store } = fakeStore(async (key) => (key.includes(':net:') ? { allowed: false, count: 2_400, resetMs: 9_000 } : { allowed: true, count: 1, resetMs: 50_000 }));
        await setRateLimitStore(store);

        const result = await checkRateLimit(fromDevice('/api/settlements/preview', 'sx_device=' + mintDevice()));
        expect(result).toMatchObject({ outcome: 'deny', scope: 'network', limit: 2_400, remaining: 0, resetMs: 9_000 });
        expect(await checks('preview_network', 'deny')).toBe(1);
    });

    it("does not spend the network's allowance on a request the device's own limit refused", async () => {
        const { store, calls } = fakeStore(async () => ({ allowed: false, count: 60, resetMs: 5_000 }));
        await setRateLimitStore(store);

        const result = await checkRateLimit(fromDevice('/api/settlements/preview', 'sx_device=' + mintDevice()));
        expect(result).toMatchObject({ outcome: 'deny', scope: 'identity' });
        expect(calls).toHaveLength(1);
    });

    it('keeps one check, against the address, for a request with no device cookie', async () => {
        const { store, calls } = fakeStore(async () => ({ allowed: true, count: 1, resetMs: 1 }));
        await setRateLimitStore(store);

        await checkRateLimit(fromDevice('/api/settlements/preview', ''));
        expect(calls).toHaveLength(1);
        expect(calls[0].key).toMatch(/^preview:ip:/);
        expect(calls[0]).toMatchObject({ limit: 60 });
    });

    it('reads the network ceilings from the environment', async () => {
        vi.stubEnv('RATE_LIMIT_PREVIEW_NETWORK_PER_MINUTE', '500');
        vi.stubEnv('RATE_LIMIT_API_NETWORK_PER_MINUTE', '700');
        const { store, calls } = fakeStore(async () => ({ allowed: true, count: 1, resetMs: 1 }));
        await setRateLimitStore(store);

        await checkRateLimit(fromDevice('/api/settlements/preview', 'sx_device=' + mintDevice()));
        await checkRateLimit(fromDevice('/api/groups', 'sx_device=' + mintDevice()));
        expect(calls[1].limit).toBe(500);
        expect(calls[3].limit).toBe(700);
    });
});
