import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { auth, prisma } = vi.hoisted(() => ({
    auth: vi.fn(),
    prisma: { user: { findUnique: vi.fn() } },
}));
vi.mock('@/lib/auth', () => ({ auth }));
vi.mock('@/lib/db', () => ({ prisma }));

const { operatorList, opsViewer } = await import('@/lib/ops/access');

beforeEach(() => {
    vi.stubEnv('OPS_ADMINS', 'github:12345678, google:109876543210');
    auth.mockResolvedValue({ user: { email: 'alice@example.com' } });
});
afterEach(() => {
    vi.resetAllMocks();
    vi.unstubAllEnvs();
});

describe('who may open /ops', () => {
    it('reads operators as provider:account pairs, ignoring spaces and empty entries', () => {
        expect([...operatorList(' github:1 ,, google:2 ')]).toEqual(['github:1', 'google:2']);
        expect(operatorList('').size).toBe(0);
        // Without a value it reads OPS_ADMINS.
        expect([...operatorList()]).toEqual(['github:12345678', 'google:109876543210']);
    });

    it('lets in someone whose provider account is listed', async () => {
        prisma.user.findUnique.mockResolvedValue({ accounts: [{ provider: 'github', providerAccountId: '12345678' }] });

        expect(await opsViewer()).toEqual({ allowed: true, identities: ['github:12345678'] });
    });

    it('keeps out anyone else, and tells them their own identity to be added', async () => {
        prisma.user.findUnique.mockResolvedValue({ accounts: [{ provider: 'google', providerAccountId: '555' }] });

        expect(await opsViewer()).toEqual({ allowed: false, identities: ['google:555'] });
    });

    it('never counts an email address: a password account has no provider identity', async () => {
        vi.stubEnv('OPS_ADMINS', 'alice@example.com');
        prisma.user.findUnique.mockResolvedValue({ accounts: [] });

        expect(await opsViewer()).toEqual({ allowed: false, identities: [] });
    });

    it('lets nobody in when no operator is configured', async () => {
        vi.stubEnv('OPS_ADMINS', '');
        prisma.user.findUnique.mockResolvedValue({ accounts: [{ provider: 'github', providerAccountId: '12345678' }] });

        expect((await opsViewer())?.allowed).toBe(false);
    });

    it('is null for someone signed out', async () => {
        auth.mockResolvedValue(null);
        expect(await opsViewer()).toBeNull();
        expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });
});
