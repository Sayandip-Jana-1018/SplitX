import { randomUUID } from 'node:crypto';
import IORedis from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRedisStore, windowKeys, type RateLimitStore } from '@/lib/rateLimit/store';

const REDIS_URL = process.env.REDIS_URL as string;
const errors: Error[] = [];
let store: RateLimitStore;
let admin: IORedis;

const uniqueKey = () => `test:${randomUUID()}`;
// Start each scenario well inside a window so timing can't straddle a boundary.
const midWindow = (windowMs: number) => Math.floor(Date.now() / windowMs) * windowMs + windowMs / 4;

beforeAll(async () => {
    store = createRedisStore(REDIS_URL, (error) => errors.push(error));
    admin = new IORedis(REDIS_URL);
    await admin.ping();
});

afterAll(async () => {
    await store.close();
    await admin.quit();
});

describe('sliding window on real Redis', () => {
    it('allows exactly the limit, then denies, and reports what is left', async () => {
        const key = uniqueKey();
        const now = midWindow(60_000);
        const results = [];
        for (let i = 0; i < 7; i++) results.push(await store.hit(key, 5, 60_000, now));

        expect(results.map((r) => r.allowed)).toEqual([true, true, true, true, true, false, false]);
        expect(results.map((r) => 5 - r.count).slice(0, 5)).toEqual([4, 3, 2, 1, 0]);
        expect(results[5].resetMs).toBeGreaterThan(0);
        expect(results[5].resetMs).toBeLessThanOrEqual(60_000);
    });

    it('is atomic: 200 concurrent requests against a limit of 25 admit exactly 25', async () => {
        const key = uniqueKey();
        const now = midWindow(60_000);
        const results = await Promise.all(Array.from({ length: 200 }, () => store.hit(key, 25, 60_000, now)));

        expect(results.filter((r) => r.allowed)).toHaveLength(25);
    });

    it('keeps identities independent', async () => {
        const now = midWindow(60_000);
        const alice = uniqueKey();
        const bob = uniqueKey();
        for (let i = 0; i < 3; i++) await store.hit(alice, 3, 60_000, now);

        expect((await store.hit(alice, 3, 60_000, now)).allowed).toBe(false);
        expect((await store.hit(bob, 3, 60_000, now)).allowed).toBe(true);
    });

    it('slides: last window’s hits count in proportion to their overlap', async () => {
        const key = uniqueKey();
        const windowMs = 10_000;
        const start = Math.floor(Date.now() / windowMs) * windowMs;

        // Fill the limit early in one window…
        for (let i = 0; i < 10; i++) await store.hit(key, 10, windowMs, start + 1_000);
        expect((await store.hit(key, 10, windowMs, start + 2_000)).allowed).toBe(false);

        // …a quarter into the next window, 75% of those 10 still count (7.5, rounded
        // up to 8), so only 2 new requests fit.
        const quarterIn = start + windowMs + windowMs / 4;
        const next = [];
        for (let i = 0; i < 4; i++) next.push(await store.hit(key, 10, windowMs, quarterIn));
        expect(next.map((r) => r.allowed)).toEqual([true, true, false, false]);

        // Two full windows later the old hits no longer count at all.
        expect((await store.hit(key, 10, windowMs, start + 2 * windowMs + 100)).allowed).toBe(true);
    });

    it('never admits more than the limit across a window boundary (found live: rounding down let one extra through)', async () => {
        const key = uniqueKey();
        const windowMs = 60_000;
        const boundary = (Math.floor(Date.now() / windowMs) + 1) * windowMs;

        // Two hits just before the boundary, then a burst 1 ms after it.
        await store.hit(key, 5, windowMs, boundary - 50);
        await store.hit(key, 5, windowMs, boundary - 40);
        const burst = [];
        for (let i = 0; i < 6; i++) burst.push(await store.hit(key, 5, windowMs, boundary + 1));

        expect(2 + burst.filter((r) => r.allowed).length).toBeLessThanOrEqual(5);
    });

    it('expires its keys so idle identities cost no memory', async () => {
        const key = uniqueKey();
        const windowMs = 5_000;
        const now = midWindow(windowMs);
        await store.hit(key, 10, windowMs, now);

        const [current] = windowKeys(key, windowMs, now);
        const ttl = await admin.pttl(current);
        expect(ttl).toBeGreaterThan(0);
        expect(ttl).toBeLessThanOrEqual(2 * windowMs);
    });

    it('fails fast instead of hanging when Redis is unreachable', async () => {
        const unreachable = createRedisStore('redis://127.0.0.1:1', () => {});
        const started = performance.now();
        await expect(unreachable.hit(uniqueKey(), 10, 60_000, Date.now())).rejects.toThrow();
        expect(performance.now() - started).toBeLessThan(2_500);
        await unreachable.close();
    });
});
