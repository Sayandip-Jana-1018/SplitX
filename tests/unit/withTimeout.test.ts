import { afterEach, describe, expect, it, vi } from 'vitest';
import { withTimeout } from '@/lib/withTimeout';

describe('withTimeout', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('resolves with the value when the promise settles in time', async () => {
        await expect(withTimeout(Promise.resolve(42), 1_000)).resolves.toBe(42);
    });

    it('passes through the original rejection', async () => {
        await expect(withTimeout(Promise.reject(new Error('db down')), 1_000)).rejects.toThrow('db down');
    });

    it('rejects once the deadline passes', async () => {
        vi.useFakeTimers();
        const pending = withTimeout(new Promise(() => {}), 2_000);
        const assertion = expect(pending).rejects.toThrow('Timed out after 2000ms');
        await vi.advanceTimersByTimeAsync(2_000);
        await assertion;
    });

    it('never leaves its timer behind', async () => {
        vi.useFakeTimers();
        await withTimeout(Promise.resolve('done'), 5_000);
        expect(vi.getTimerCount()).toBe(0);

        await withTimeout(Promise.reject(new Error('boom')), 5_000).catch(() => undefined);
        expect(vi.getTimerCount()).toBe(0);
    });
});
