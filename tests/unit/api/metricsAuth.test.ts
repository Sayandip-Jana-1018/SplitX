import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ prisma: { group: { count: vi.fn().mockResolvedValue(3) } } }));

describe('GET /api/metrics asks for the scrape token', () => {
    beforeEach(() => vi.stubEnv('METRICS_TOKEN', 'scrape-secret'));
    afterEach(() => vi.unstubAllEnvs());

    const scrape = async (authorization?: string) => {
        const { GET } = await import('@/app/api/metrics/route');
        const headers = authorization === undefined ? undefined : { authorization };
        return (await GET(new Request('http://localhost/api/metrics', { headers }))).status;
    };

    it('serves the bearer of the token, however the scheme is written and spaced', async () => {
        expect(await scrape('Bearer scrape-secret')).toBe(200);
        expect(await scrape('bearer \t scrape-secret')).toBe(200);
    });

    it('refuses no token, another token, another scheme, and a scheme with nothing after it', async () => {
        expect(await scrape()).toBe(401);
        expect(await scrape('Bearer other-secret')).toBe(401);
        expect(await scrape('Basic scrape-secret')).toBe(401);
        expect(await scrape('Bearerscrape-secret')).toBe(401);
        expect(await scrape('Bearer \t ')).toBe(401);
    });
});
