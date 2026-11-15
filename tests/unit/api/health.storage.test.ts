import { beforeEach, describe, expect, it, vi } from 'vitest';

const list = vi.fn();
class StorageUnavailableError extends Error {}
let configured = true;
vi.mock('@/lib/storage', () => ({
    StorageUnavailableError,
    storageAdmin: () => {
        if (!configured) throw new StorageUnavailableError();
        return { storage: { from: () => ({ list }) } };
    },
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));

const { GET, forgetStorageLook } = await import('@/app/api/health/storage/route');

beforeEach(() => {
    forgetStorageLook();
    list.mockReset();
    configured = true;
    vi.useRealTimers();
});

describe('GET /api/health/storage (the hourly look that keeps Supabase awake)', () => {
    it('is ready when the receipts bucket answers, and says nothing of what it holds', async () => {
        list.mockResolvedValue({ data: [{ name: 'someone/secret.jpg' }], error: null });
        const answer = await GET();
        expect(answer.status).toBe(200);
        const body = await answer.json();
        expect(body).toEqual({ status: 'ready', checks: { storage: 'ok' } });
        expect(JSON.stringify(body)).not.toContain('secret');
        expect(answer.headers.get('cache-control')).toBe('no-store');
    });

    it('answers 503 when Supabase refuses or isn’t set up', async () => {
        list.mockResolvedValue({ data: null, error: new Error('paused') });
        expect((await (await GET()).json()).checks.storage).toBe('unreachable');
        forgetStorageLook();
        configured = false;
        const answer = await GET();
        expect(answer.status).toBe(503);
        expect((await answer.json()).checks.storage).toBe('not_configured');
    });

    it('shares one look for ten minutes, however many ask', async () => {
        vi.useFakeTimers();
        list.mockResolvedValue({ data: [], error: null });
        await Promise.all([GET(), GET(), GET()]);
        await GET();
        expect(list).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(10 * 60_000);
        await GET();
        expect(list).toHaveBeenCalledTimes(2);
    });
});
