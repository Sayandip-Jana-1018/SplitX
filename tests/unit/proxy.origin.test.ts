import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { metrics } from '@/lib/metrics';
import { setRateLimitStore } from '@/lib/rateLimit';
import type { RateLimitStore } from '@/lib/rateLimit/store';
import { proxy } from '@/proxy';
import { INTERNAL_SPELLINGS } from '../../scripts/lib/platform-checks.mjs';

/*
 * On the EKS platform the load balancer is open to the internet, the only way
 * the edge (an API Gateway HTTP API, D-114) can reach it. Only requests
 * carrying the header our edge adds may reach the app; the rest are refused
 * before any other work is done. Through the edge, the internal paths are
 * refused in every spelling, which an edge function did when the edge was
 * to be CloudFront.
 */

const SECRET = 'a'.repeat(64);
const allowAll: RateLimitStore = { backend: 'redis', hit: async () => ({ allowed: true, count: 1, resetMs: 60_000 }), warm: async () => {}, close: async () => {} };

const visit = (path: string, headers: Record<string, string> = {}, method = 'GET') =>
    proxy(new NextRequest(`http://splitx.example${path}`, { method, headers }));

const refusals = async () =>
    (await metrics.proxyDecisions.get()).values.find((v) => v.labels.decision === 'origin_refused')?.value ?? 0;

describe('only through our edge', () => {
    beforeEach(async () => {
        await setRateLimitStore(allowAll);
        vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
        vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    });
    afterEach(async () => {
        await setRateLimitStore(undefined);
        vi.restoreAllMocks();
        vi.unstubAllEnvs();
    });

    it('changes nothing where no secret is configured (Vercel, Kind)', async () => {
        const res = await visit('/login');
        expect(res.status).toBe(200);
        expect(res.headers.get('x-middleware-next')).toBe('1');
    });

    describe('with the secret configured', () => {
        beforeEach(() => vi.stubEnv('ORIGIN_VERIFY_SECRET', SECRET));

        it.each([
            ['no header', {}],
            ['a wrong value', { 'x-origin-verify': 'b'.repeat(64) }],
            ['a value of another length', { 'x-origin-verify': SECRET + 'x' }],
        ])('refuses a request with %s, and counts it', async (_, headers) => {
            const before = await refusals();
            const res = await visit('/dashboard', headers);

            expect(res.status).toBe(403);
            expect(await res.text()).toBe('Not available');
            expect(res.headers.get('cache-control')).toBe('no-store');
            expect(res.headers.get('location')).toBeNull();
            expect(await refusals()).toBe(before + 1);
        });

        it('refuses an API call too, before the rate limiter is asked', async () => {
            const hit = vi.fn(allowAll.hit);
            await setRateLimitStore({ ...allowAll, hit });
            const res = await visit('/api/transactions', {}, 'POST');

            expect(res.status).toBe(403);
            expect(hit).not.toHaveBeenCalled();
        });

        it('lets our edge\'s requests through, without passing the secret on to the route', async () => {
            const res = await visit('/login', { 'x-origin-verify': SECRET });

            expect(res.status).toBe(200);
            expect(res.headers.get('x-middleware-next')).toBe('1');
            expect(res.headers.get('x-middleware-override-headers')).not.toContain('x-origin-verify');
            expect(res.headers.get('x-middleware-request-x-origin-verify')).toBeNull();
        });

        it.each(['/api/health/live', '/api/health/ready', '/api/metrics'])(
            'lets %s through without it: the load balancer, the kubelet and Prometheus reach pods directly',
            async (path) => {
                const res = await visit(path);
                expect(res.status).not.toBe(403);
            },
        );

        it('does not exempt the combined health endpoint, which only the edge serves', async () => {
            expect((await visit('/api/health')).status).toBe(403);
        });

        it.each(INTERNAL_SPELLINGS)('refuses %s when it came through the edge, and counts it', async (path) => {
            const before = await refusals();
            const res = await visit(path, { 'x-origin-verify': SECRET });

            expect(res.status).toBe(403);
            expect(await res.text()).toBe('Not available');
            expect(await refusals()).toBe(before + 1);
        });

        it('still serves the live probe through the edge, which the workflows check it by', async () => {
            const res = await visit('/api/health/live', { 'x-origin-verify': SECRET });
            expect(res.status).not.toBe(403);
        });

        it('changes nothing under next dev, which never runs behind the edge, though .env holds the secret', async () => {
            vi.stubEnv('NODE_ENV', 'development');
            const res = await visit('/dashboard');

            expect(res.status).not.toBe(403);
            expect(res.headers.get('location')).toContain('/login');
            expect((await visit('/login')).headers.get('x-middleware-next')).toBe('1');
        });
    });
});
