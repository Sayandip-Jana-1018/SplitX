import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { signOut } = vi.hoisted(() => ({ signOut: vi.fn() }));
vi.mock('next-auth/react', () => ({ signOut }));

// A page that lost its session gets 401s from every request it has in flight.
// Signing out (not just going to /login) matters: the page gate would send a
// browser that still carries the cookie from /login straight back.
describe('sessionEnded', () => {
    beforeEach(() => {
        vi.resetModules();
        signOut.mockResolvedValue(undefined);
    });
    afterEach(() => vi.resetAllMocks());

    it('signs out once, however many requests fail together', async () => {
        const { sessionEnded } = await import('@/lib/signOut');

        sessionEnded();
        sessionEnded();
        sessionEnded();
        await vi.waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));

        expect(signOut).toHaveBeenCalledWith({ callbackUrl: '/login' });
    });

    it('comes back to where the person was going after signing in', async () => {
        const { sessionEnded } = await import('@/lib/signOut');

        sessionEnded('/join/abc123');
        await vi.waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));

        expect(signOut).toHaveBeenCalledWith({ callbackUrl: '/login?callbackUrl=%2Fjoin%2Fabc123' });
    });
});
