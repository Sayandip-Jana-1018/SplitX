import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newTraceContext } from '@/lib/observability/trace';

describe('newTraceContext', () => {
    it('produces valid, unique W3C trace contexts', () => {
        const seen = new Set<string>();
        for (let i = 0; i < 1_000; i++) {
            const { traceId, traceparent } = newTraceContext();
            expect(traceId).toMatch(/^[0-9a-f]{32}$/);
            expect(traceId).not.toMatch(/^0+$/);
            expect(traceparent).toMatch(new RegExp(`^00-${traceId}-[0-9a-f]{16}-01$`));
            seen.add(traceId);
        }
        expect(seen.size).toBe(1_000);
    });
});

describe('proxy request IDs', () => {
    beforeEach(() => {
        // No limiter backend: exercise the plain forwarding path.
        vi.stubEnv('REDIS_URL', '');
        vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
        vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
        vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
        // The "rate limiting is disabled" warning goes to stderr.
        vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    });
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllEnvs();
        vi.resetModules();
    });

    async function run(url: string, headers: Record<string, string> = {}) {
        const { proxy } = await import('@/proxy');
        return proxy(new NextRequest(url, { headers }));
    }

    it('forwards the trace to the route and returns its ID to the client', async () => {
        const res = await run('http://localhost/api/me');
        const requestId = res.headers.get('x-request-id');
        const forwardedTraceparent = res.headers.get('x-middleware-request-traceparent');

        expect(requestId).toMatch(/^[0-9a-f]{32}$/);
        // The route's trace is the request ID the client sees.
        expect(forwardedTraceparent).toMatch(new RegExp(`^00-${requestId}-[0-9a-f]{16}-01$`));
        expect(res.headers.get('x-middleware-request-x-request-id')).toBe(requestId);
    });

    it('replaces request IDs and trace context supplied by the client', async () => {
        const res = await run('http://localhost/api/me', {
            traceparent: '00-11111111111111111111111111111111-2222222222222222-01',
            tracestate: 'vendor=attacker',
            'x-request-id': 'attacker-chosen',
        });

        expect(res.headers.get('x-request-id')).not.toBe('attacker-chosen');
        expect(res.headers.get('x-request-id')).not.toBe('11111111111111111111111111111111');
        expect(res.headers.get('x-middleware-override-headers')).not.toContain('tracestate');
    });

    it('names the serving pod only when running in Kubernetes', async () => {
        expect((await run('http://localhost/api/me')).headers.get('x-served-by')).toBeNull();

        vi.resetModules();
        vi.stubEnv('POD_NAME', 'splitx-7d9f8c6b5-x2kqp');
        expect((await run('http://localhost/api/me')).headers.get('x-served-by')).toBe('splitx-7d9f8c6b5-x2kqp');
    });

    it('gives proxy-answered redirects a request ID too', async () => {
        const res = await run('http://localhost/dashboard');
        expect(res.status).toBe(307);
        expect(res.headers.get('x-request-id')).toMatch(/^[0-9a-f]{32}$/);
    });
});
