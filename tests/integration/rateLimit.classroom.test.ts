import { randomInt } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { checkRateLimit, setRateLimitStore } from '@/lib/rateLimit';
import { mintDevice } from '@/lib/rateLimit/device';
import { createRedisStore } from '@/lib/rateLimit/store';

/**
 * B-015 against a real Redis: a classroom of anonymous phones behind one NAT.
 * Each scenario uses a fresh random address so runs never share counters.
 */

const REDIS_URL = process.env.REDIS_URL as string;
const SECRET = 'test-secret-that-is-long-enough-for-hkdf-000000';

const randomAddress = () => `100.${randomInt(64, 128)}.${randomInt(0, 256)}.${randomInt(1, 255)}`;
const preview = (address: string, device?: string) =>
    new NextRequest('http://localhost/api/settlements/preview', {
        method: 'POST',
        headers: { 'x-forwarded-for': address, ...(device ? { cookie: `sx_device=${device}` } : {}) },
    });

async function send(address: string, device: string | undefined, times: number) {
    const outcomes = [];
    for (let i = 0; i < times; i++) outcomes.push(await checkRateLimit(preview(address, device)));
    return outcomes;
}
const allowed = (results: Awaited<ReturnType<typeof checkRateLimit>>[]) => results.filter((r) => r.outcome === 'allow').length;

beforeAll(async () => {
    vi.stubEnv('AUTH_SECRET', SECRET);
    await setRateLimitStore(createRedisStore(REDIS_URL, () => {}));
});

afterEach(() => {
    vi.stubEnv('RATE_LIMIT_PREVIEW_PER_MINUTE', '');
    vi.stubEnv('RATE_LIMIT_PREVIEW_NETWORK_PER_MINUTE', '');
});

afterAll(async () => {
    await setRateLimitStore(undefined);
    vi.unstubAllEnvs();
});

describe('a classroom behind one address, on real Redis', () => {
    it('serves forty phones planning ten times each — the class is not one person', async () => {
        const address = randomAddress();
        const phones = Array.from({ length: 40 }, () => mintDevice()!);
        const results = (await Promise.all(phones.map((phone) => send(address, phone, 10)))).flat();

        expect(allowed(results)).toBe(400);
    });

    it('slows down only the phone that goes over its own limit', async () => {
        const address = randomAddress();
        const greedy = await send(address, mintDevice()!, 80);
        const neighbour = await send(address, mintDevice()!, 10);

        expect(allowed(greedy)).toBe(60);
        expect(allowed(neighbour)).toBe(10);
    });

    it('still caps the whole network, however many identities are minted', async () => {
        vi.stubEnv('RATE_LIMIT_PREVIEW_NETWORK_PER_MINUTE', '100');
        const address = randomAddress();
        // An abuser discarding the cookie after every few requests: 60 fresh identities.
        const results = (await Promise.all(Array.from({ length: 60 }, () => send(address, mintDevice()!, 5)))).flat();

        expect(allowed(results)).toBe(100);
        expect(results.filter((r) => r.outcome === 'deny' && r.scope === 'network')).toHaveLength(200);
    });

    it("does not let one device's refused requests use up the network's allowance", async () => {
        vi.stubEnv('RATE_LIMIT_PREVIEW_PER_MINUTE', '3');
        vi.stubEnv('RATE_LIMIT_PREVIEW_NETWORK_PER_MINUTE', '10');
        const address = randomAddress();
        await send(address, mintDevice()!, 50);
        const others = (await Promise.all(Array.from({ length: 3 }, () => send(address, mintDevice()!, 3)))).flat();

        // 3 from the greedy device and 7 of the other 9 fit under the ceiling of 10.
        expect(allowed(others)).toBe(7);
    });

    it('keeps requests without a device cookie on the per-address limit, apart from the devices', async () => {
        const address = randomAddress();
        await Promise.all(Array.from({ length: 30 }, () => send(address, mintDevice()!, 5)));
        const cookieless = await send(address, undefined, 70);

        expect(allowed(cookieless)).toBe(60);
    });
});
