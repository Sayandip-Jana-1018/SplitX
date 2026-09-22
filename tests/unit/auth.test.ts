import bcrypt from 'bcryptjs';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { prisma, consumeAllowance } = vi.hoisted(() => ({
    prisma: {
        user: { findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
        account: { upsert: vi.fn() },
    },
    consumeAllowance: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ prisma }));
vi.mock('@/lib/rateLimit', () => ({ consumeAllowance }));
// next-auth itself needs Next's server runtime; the functions under test don't.
vi.mock('next-auth', () => ({ default: () => ({ handlers: {}, signIn: vi.fn(), signOut: vi.fn(), auth: vi.fn() }) }));
vi.mock('next-auth/providers/credentials', () => ({ default: (options: unknown) => options }));
vi.mock('next-auth/providers/google', () => ({ default: (options: unknown) => options }));
vi.mock('next-auth/providers/github', () => ({ default: (options: unknown) => options }));

const { authorizeCredentials, syncOAuthSignIn, verifiedProviderEmail } = await import('@/lib/auth');

let passwordHash = '';
beforeAll(async () => {
    passwordHash = await bcrypt.hash('correct horse', 4);
});

const fetchMock = vi.fn();
beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    consumeAllowance.mockResolvedValue({ outcome: 'allow', resetMs: 1_000 });
    prisma.user.update.mockImplementation(async ({ where }) => ({ id: where.id }));
    prisma.user.create.mockImplementation(async () => ({ id: 'cnewuser0000001' }));
    prisma.account.upsert.mockResolvedValue({});
});

afterEach(() => {
    vi.resetAllMocks();
    vi.unstubAllGlobals();
});

describe('authorizeCredentials', () => {
    it('finds the account whatever case the address is typed in', async () => {
        prisma.user.findFirst.mockResolvedValue({ id: 'u1', name: 'Alice', email: 'alice@example.com', image: null, password: passwordHash });

        const user = await authorizeCredentials({ email: '  Alice@Example.COM ', password: 'correct horse' });

        expect(user).toMatchObject({ id: 'u1', email: 'alice@example.com' });
        expect(prisma.user.findFirst).toHaveBeenCalledWith({ where: { email: { equals: 'alice@example.com', mode: 'insensitive' } } });
        expect(consumeAllowance).toHaveBeenCalledWith('login:alice@example.com', 10, 15 * 60 * 1000);
    });

    it('refuses a wrong password', async () => {
        prisma.user.findFirst.mockResolvedValue({ id: 'u1', email: 'alice@example.com', password: passwordHash });

        expect(await authorizeCredentials({ email: 'alice@example.com', password: 'wrong horse' })).toBeNull();
    });

    it('refuses an account past its ten tries, even with the right password', async () => {
        consumeAllowance.mockResolvedValue({ outcome: 'deny', resetMs: 60_000 });
        prisma.user.findFirst.mockResolvedValue({ id: 'u1', email: 'alice@example.com', password: passwordHash });

        expect(await authorizeCredentials({ email: 'alice@example.com', password: 'correct horse' })).toBeNull();
        expect(prisma.user.findFirst).not.toHaveBeenCalled();
    });

    it('still signs in when the attempt counter is unreachable (the per-address limit remains)', async () => {
        consumeAllowance.mockResolvedValue({ outcome: 'unavailable' });
        prisma.user.findFirst.mockResolvedValue({ id: 'u1', email: 'alice@example.com', password: passwordHash });

        expect(await authorizeCredentials({ email: 'alice@example.com', password: 'correct horse' })).not.toBeNull();
    });

    it('refuses an account that has no password (Google or GitHub only)', async () => {
        prisma.user.findFirst.mockResolvedValue({ id: 'u1', email: 'alice@example.com', password: null });

        expect(await authorizeCredentials({ email: 'alice@example.com', password: 'anything at all' })).toBeNull();
    });
});

describe('verifiedProviderEmail', () => {
    const github = { provider: 'github', access_token: 'gho_test' };
    const emails = (list: { email: string; primary: boolean; verified: boolean }[]) =>
        fetchMock.mockResolvedValue(new Response(JSON.stringify(list), { status: 200 }));

    it('takes a Google address only when Google verified it', async () => {
        expect(await verifiedProviderEmail({ provider: 'google' }, { email_verified: true }, 'Alice@Example.com')).toBe('alice@example.com');
        expect(await verifiedProviderEmail({ provider: 'google' }, { email_verified: false }, 'alice@example.com')).toBeNull();
        expect(await verifiedProviderEmail({ provider: 'google' }, {}, 'alice@example.com')).toBeNull();
    });

    it("takes GitHub's primary address when it is verified", async () => {
        emails([
            { email: 'old@example.com', primary: false, verified: true },
            { email: 'Main@Example.com', primary: true, verified: true },
        ]);

        expect(await verifiedProviderEmail(github, undefined, null)).toBe('main@example.com');
    });

    it('falls back to another verified GitHub address, never an unverified one', async () => {
        emails([
            { email: 'victim@example.com', primary: true, verified: false },
            { email: 'mine@example.com', primary: false, verified: true },
        ]);
        expect(await verifiedProviderEmail(github, undefined, null)).toBe('mine@example.com');

        emails([{ email: 'victim@example.com', primary: true, verified: false }]);
        expect(await verifiedProviderEmail(github, undefined, 'victim@example.com')).toBeNull();
    });

    it('refuses when GitHub cannot be asked', async () => {
        fetchMock.mockResolvedValue(new Response('{}', { status: 401 }));

        expect(await verifiedProviderEmail(github, undefined, 'alice@example.com')).toBeNull();
    });
});

describe('syncOAuthSignIn', () => {
    const google = { provider: 'google', type: 'oidc', providerAccountId: 'g-123' } as const;
    const signIn = (existing: Record<string, unknown> | null) => {
        prisma.user.findFirst.mockResolvedValue(existing);
        return syncOAuthSignIn({
            user: { name: 'Alice G', email: 'Alice@Example.com', image: 'https://photo' },
            account: google,
            profile: { email_verified: true, name: 'Alice G' },
        });
    };

    it('removes a password set before anyone proved they own the address', async () => {
        expect(await signIn({ id: 'u1', name: 'Alice', image: null, password: passwordHash, emailVerified: null })).toBe(true);

        expect(prisma.user.update.mock.calls[0][0].data).toMatchObject({ password: null, emailVerified: expect.any(Date) });
    });

    it('keeps the password of an account whose address was already proven', async () => {
        await signIn({ id: 'u1', name: 'Alice', image: null, password: passwordHash, emailVerified: new Date('2026-01-01') });

        expect(prisma.user.update.mock.calls[0][0].data).not.toHaveProperty('password');
    });

    it('keeps a name and photo the person chose', async () => {
        await signIn({ id: 'u1', name: 'Alice', image: 'https://mine', password: null, emailVerified: null });

        const data = prisma.user.update.mock.calls[0][0].data;
        expect(data).not.toHaveProperty('name');
        expect(data).not.toHaveProperty('image');
    });

    it('creates an account in lower case', async () => {
        await signIn(null);

        expect(prisma.user.create.mock.calls[0][0].data).toMatchObject({ email: 'alice@example.com', name: 'Alice G' });
    });

    it('refuses a sign-in without a verified address, and touches nothing', async () => {
        const allowed = await syncOAuthSignIn({
            user: { email: 'alice@example.com' },
            account: google,
            profile: { email_verified: false },
        });

        expect(allowed).toBe(false);
        expect(prisma.user.findFirst).not.toHaveBeenCalled();
    });
});
