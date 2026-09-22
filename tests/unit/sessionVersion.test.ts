import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { prisma } = vi.hoisted(() => ({ prisma: { user: { findUnique: vi.fn() } } }));
vi.mock('@/lib/db', () => ({ prisma }));

const { currentTokenVersion, forgetAllTokenVersions, forgetTokenVersion, TRUST_VERSION_FOR_MS } = await import('@/lib/sessionVersion');

beforeEach(() => {
    prisma.user.findUnique.mockResolvedValue({ tokenVersion: 3 });
});

afterEach(() => {
    vi.resetAllMocks();
    forgetAllTokenVersions();
});

describe('currentTokenVersion', () => {
    it('reads an account\'s version once, and trusts it for 30 seconds', async () => {
        expect(await currentTokenVersion('u1', { now: 0 })).toBe(3);
        expect(await currentTokenVersion('u1', { now: TRUST_VERSION_FOR_MS - 1 })).toBe(3);
        expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
        expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: 'u1' }, select: { tokenVersion: true } });

        prisma.user.findUnique.mockResolvedValue({ tokenVersion: 4 });
        expect(await currentTokenVersion('u1', { now: TRUST_VERSION_FOR_MS })).toBe(4);
        expect(prisma.user.findUnique).toHaveBeenCalledTimes(2);
    });

    it('reads afresh when asked (a session being issued), and remembers what it read', async () => {
        await currentTokenVersion('u1', { now: 0 });
        prisma.user.findUnique.mockResolvedValue({ tokenVersion: 4 });

        expect(await currentTokenVersion('u1', { fresh: true, now: 1 })).toBe(4);
        expect(await currentTokenVersion('u1', { now: 2 })).toBe(4);
        expect(prisma.user.findUnique).toHaveBeenCalledTimes(2);
    });

    it('reads afresh once the version was raised on this server', async () => {
        await currentTokenVersion('u1', { now: 0 });
        prisma.user.findUnique.mockResolvedValue({ tokenVersion: 4 });

        forgetTokenVersion('u1');

        expect(await currentTokenVersion('u1', { now: 1 })).toBe(4);
    });

    it('is null for an account that doesn\'t exist', async () => {
        prisma.user.findUnique.mockResolvedValue(null);

        expect(await currentTokenVersion('gone')).toBeNull();
    });
});
