import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { metrics } from '@/lib/metrics';
import { setRateLimitStore } from '@/lib/rateLimit';
import type { RateLimitStore } from '@/lib/rateLimit/store';
import { proxy } from '@/proxy';

const nginxStamp = (msAgo: number) => {
    const at = Date.now() - msAgo;
    return 't=' + Math.floor(at / 1000) + '.' + String(at % 1000).padStart(3, '0');
};

const send = (path: string, msAgo: number, method = 'POST') =>
    proxy(new NextRequest('http://localhost' + path, { method, headers: { 'x-forwarded-for': '203.0.113.9', 'x-request-start': nginxStamp(msAgo) } }));

type ReadableCounter = { get(): Promise<{ values: { value: number; labels: Partial<Record<string, string | number>> }[] }> };

async function counter(metric: ReadableCounter, labels: Record<string, string>) {
    const { values } = await metric.get();
    return values.find((v) => Object.entries(labels).every(([key, value]) => v.labels[key] === value))?.value ?? 0;
}

describe('front-door load shedding (B-016)', () => {
    let hit: Mock<RateLimitStore['hit']>;

    beforeEach(async () => {
        vi.stubEnv('TRUST_UPSTREAM_REQUEST_START', 'true');
        hit = vi.fn<RateLimitStore['hit']>(async () => ({ allowed: true, count: 1, resetMs: 60_000 }));
        const store: RateLimitStore = { backend: 'redis', hit, warm: async () => {}, close: async () => {} };
        await setRateLimitStore(store);
        metrics.proxyDecisions.reset();
        metrics.settlementPreviews.reset();
        metrics.httpRequestsTotal.reset();
        vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
        vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    });
    afterEach(async () => {
        await setRateLimitStore(undefined);
        vi.restoreAllMocks();
        vi.unstubAllEnvs();
    });

    it('refuses an overdue preview before the rate limiter or the body is touched', async () => {
        const res = await send('/api/settlements/preview', 1_500);

        expect(res.status).toBe(503);
        expect(res.headers.get('retry-after')).toBe('1');
        expect(await res.json()).toMatchObject({ code: 'OVERLOADED', requestId: res.headers.get('x-request-id') });
        expect(hit).not.toHaveBeenCalled();
    });

    it('counts the refusal once, as a proxy decision and as a response, without a log line', async () => {
        const writes = vi.mocked(process.stdout.write);
        writes.mockClear();
        await send('/api/settlements/preview', 1_500);

        expect(await counter(metrics.proxyDecisions, { decision: 'shed' })).toBe(1);
        expect(await counter(metrics.settlementPreviews, { mode: 'unknown', outcome: 'shed' })).toBe(1);
        expect(await counter(metrics.httpRequestsTotal, { route: '(proxy)', status_code: '503' })).toBe(1);
        expect(writes).not.toHaveBeenCalled();
    });

    it('lets a preview that is still within its budget through to the limiter', async () => {
        const res = await send('/api/settlements/preview', 200);
        expect(res.status).toBe(200);
        expect(hit).toHaveBeenCalledTimes(1);
    });

    it('follows PREVIEW_MAX_QUEUE_MS', async () => {
        vi.stubEnv('PREVIEW_MAX_QUEUE_MS', '5000');
        expect((await send('/api/settlements/preview', 1_500)).status).toBe(200);
        expect((await send('/api/settlements/preview', 6_000)).status).toBe(503);
    });

    it('never sheds at the proxy when the deployment does not trust an upstream stamp', async () => {
        vi.stubEnv('TRUST_UPSTREAM_REQUEST_START', '');
        const res = await send('/api/settlements/preview', 30_000);
        expect(res.status).toBe(200);
        expect(hit).toHaveBeenCalledTimes(1);
    });

    it('only applies to planning a preview: other routes and methods are never shed here', async () => {
        expect((await send('/api/groups', 30_000)).status).toBe(200);
        expect((await send('/api/settlements/preview', 30_000, 'GET')).status).toBe(200);
        expect((await send('/api/health/live', 30_000, 'GET')).status).toBe(200);
    });
});
