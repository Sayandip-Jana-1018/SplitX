import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { hashSecretToken } from '@/lib/secretTokens';
import { jsonRequest } from '../helpers/http';

const { prisma, tx, consumeAllowance, emailTransport, sendVerificationEmail, sendAlreadyRegisteredEmail } = vi.hoisted(() => ({
    prisma: {
        user: { findFirst: vi.fn(), create: vi.fn() },
        verificationToken: { deleteMany: vi.fn(), create: vi.fn() },
        $transaction: vi.fn(),
    },
    tx: {
        verificationToken: { findUnique: vi.fn(), deleteMany: vi.fn() },
        user: { updateMany: vi.fn(), count: vi.fn() },
    },
    consumeAllowance: vi.fn(),
    emailTransport: vi.fn(),
    sendVerificationEmail: vi.fn(),
    sendAlreadyRegisteredEmail: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ prisma }));
vi.mock('@/lib/rateLimit', () => ({ consumeAllowance }));
vi.mock('@/lib/email', () => ({ emailTransport, sendVerificationEmail, sendAlreadyRegisteredEmail }));

const verification = await import('@/lib/emailVerification');
const register = await import('@/app/api/register/route');
const verifyRoute = await import('@/app/api/auth/verify-email/route');
const resendRoute = await import('@/app/api/auth/resend-verification/route');

beforeEach(() => {
    prisma.$transaction.mockImplementation(async (arg: unknown) => (typeof arg === 'function' ? arg(tx) : Promise.all(arg as Promise<unknown>[])));
    prisma.verificationToken.deleteMany.mockResolvedValue({ count: 0 });
    prisma.verificationToken.create.mockResolvedValue({});
    consumeAllowance.mockResolvedValue({ outcome: 'allow', resetMs: 1_000 });
    emailTransport.mockReturnValue('smtp');
    sendVerificationEmail.mockResolvedValue(undefined);
    sendAlreadyRegisteredEmail.mockResolvedValue(undefined);
});

afterEach(() => vi.resetAllMocks());

describe('sendVerificationLink', () => {
    it('replaces any earlier link, keeps only its hash, and emails the token', async () => {
        expect(await verification.sendVerificationLink('alice@example.com')).toBe(true);

        expect(prisma.verificationToken.deleteMany).toHaveBeenCalledWith({ where: { identifier: 'alice@example.com' } });
        const sent = sendVerificationEmail.mock.calls[0][1] as string;
        const stored = prisma.verificationToken.create.mock.calls[0][0].data;
        expect(stored.token).toBe(hashSecretToken(sent));
        expect(stored.expires.getTime() - Date.now()).toBeGreaterThan(23 * 60 * 60 * 1000);
        expect(consumeAllowance).toHaveBeenCalledWith('verify-mail:alice@example.com', 1, 10 * 60 * 1000);
    });

    it('sends at most one link every ten minutes', async () => {
        consumeAllowance.mockResolvedValue({ outcome: 'deny', resetMs: 300_000 });

        expect(await verification.sendVerificationLink('alice@example.com')).toBe(false);
        expect(sendVerificationEmail).not.toHaveBeenCalled();
        expect(prisma.verificationToken.create).not.toHaveBeenCalled();
    });
});

describe('confirmEmail', () => {
    beforeEach(() => {
        tx.verificationToken.findUnique.mockResolvedValue({ identifier: 'alice@example.com' });
        tx.verificationToken.deleteMany.mockResolvedValue({ count: 1 });
        tx.user.updateMany.mockResolvedValue({ count: 1 });
    });

    it('marks the address confirmed, looking the link up by hash', async () => {
        expect(await verification.confirmEmail('abc')).toBe(true);

        expect(tx.verificationToken.findUnique).toHaveBeenCalledWith({ where: { token: hashSecretToken('abc') } });
        expect(tx.user.updateMany).toHaveBeenCalledWith({
            where: { email: { equals: 'alice@example.com', mode: 'insensitive' }, emailVerified: null },
            data: { emailVerified: expect.any(Date) },
        });
    });

    it('works once: a used or expired link changes nothing', async () => {
        tx.verificationToken.deleteMany.mockResolvedValue({ count: 0 });

        expect(await verification.confirmEmail('abc')).toBe(false);
        expect(tx.user.updateMany).not.toHaveBeenCalled();
    });
});

describe('POST /api/register', () => {
    const signUp = (email = 'Friend@Example.com') => register.POST(jsonRequest('http://localhost/api/register', {
        name: 'Friend',
        email,
        password: 'a long enough password',
    }));

    beforeEach(() => {
        prisma.user.findFirst.mockResolvedValue(null);
        prisma.user.create.mockResolvedValue({ id: 'cnewuser0000001', name: 'Friend', email: 'friend@example.com' });
    });

    it('opens the account unconfirmed and emails a link, in lower case', async () => {
        const res = await signUp();

        expect(res.status).toBe(201);
        expect(await res.json()).toEqual({ message: 'Check your email: we sent a link to confirm your address.', verificationSent: true });
        expect(prisma.user.create.mock.calls[0][0].data).toMatchObject({ email: 'friend@example.com' });
        expect(prisma.user.create.mock.calls[0][0].data).not.toHaveProperty('emailVerified');
        expect(sendVerificationEmail).toHaveBeenCalledWith('friend@example.com', expect.any(String));
    });

    it('answers a taken address exactly as a new one, and tells its owner instead', async () => {
        prisma.user.findFirst.mockResolvedValue({ id: 'u1' });

        const res = await signUp();

        expect(res.status).toBe(201);
        expect(await res.json()).toEqual({ message: 'Check your email: we sent a link to confirm your address.', verificationSent: true });
        expect(prisma.user.create).not.toHaveBeenCalled();
        expect(sendAlreadyRegisteredEmail).toHaveBeenCalledWith('friend@example.com');
    });

    it('treats a sign-up racing another with the same address as the repeat', async () => {
        prisma.user.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' }));

        const res = await signUp();

        expect(res.status).toBe(201);
        expect(sendAlreadyRegisteredEmail).toHaveBeenCalled();
    });

    it('without a way to send email, opens the account ready to use and refuses a taken address as before', async () => {
        emailTransport.mockReturnValue(null);

        const created = await signUp();
        expect(created.status).toBe(201);
        expect((await created.json()).verificationSent).toBe(false);
        expect(sendVerificationEmail).not.toHaveBeenCalled();

        prisma.user.findFirst.mockResolvedValue({ id: 'u1' });
        expect((await signUp()).status).toBe(409);
    });
});

describe('POST /api/auth/verify-email and /resend-verification', () => {
    it('confirms with a valid link and refuses anything else', async () => {
        tx.verificationToken.findUnique.mockResolvedValue({ identifier: 'alice@example.com' });
        tx.verificationToken.deleteMany.mockResolvedValue({ count: 1 });
        tx.user.updateMany.mockResolvedValue({ count: 1 });
        expect((await verifyRoute.POST(jsonRequest('http://localhost/api/auth/verify-email', { token: 'abc' }))).status).toBe(200);

        expect((await verifyRoute.POST(jsonRequest('http://localhost/api/auth/verify-email', {}))).status).toBe(400);
    });

    it('sends a new link only to an unconfirmed password account, answering the same for all', async () => {
        const ask = async (user: Record<string, unknown> | null) => {
            prisma.user.findFirst.mockResolvedValue(user);
            const res = await resendRoute.POST(jsonRequest('http://localhost/api/auth/resend-verification', { email: 'alice@example.com' }));
            return (await res.json()).message;
        };

        const unconfirmed = await ask({ email: 'alice@example.com', password: 'hash', emailVerified: null });
        expect(sendVerificationEmail).toHaveBeenCalledTimes(1);

        const confirmed = await ask({ email: 'alice@example.com', password: 'hash', emailVerified: new Date() });
        const nobody = await ask(null);
        expect(sendVerificationEmail).toHaveBeenCalledTimes(1);
        expect(new Set([unconfirmed, confirmed, nobody]).size).toBe(1);
    });
});
