import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { metrics } from '@/lib/metrics';
import { checkRateLimit, setRateLimitStore } from '@/lib/rateLimit';
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
