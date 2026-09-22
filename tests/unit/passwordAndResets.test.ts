import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeEmail, passwordProblem } from '@/lib/password';
import { clearLocalLimits, hitLocally } from '@/lib/rateLimit/local';
import { hashSecretToken } from '@/lib/secretTokens';
import { jsonRequest } from '../helpers/http';

const { prisma, tx, sendPasswordResetEmail, emailTransport, forgetTokenVersion, consumeAllowance } = vi.hoisted(() => ({
    prisma: {
        user: { findFirst: vi.fn() },
        passwordResetToken: { deleteMany: vi.fn(), create: vi.fn() },
        $transaction: vi.fn(),
    },
    tx: {
        passwordResetToken: { findUnique: vi.fn(), deleteMany: vi.fn() },
        user: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    },
    sendPasswordResetEmail: vi.fn(),
    emailTransport: vi.fn(),
    forgetTokenVersion: vi.fn(),
    consumeAllowance: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ prisma }));
vi.mock('@/lib/email', () => ({ sendPasswordResetEmail, emailTransport }));
vi.mock('@/lib/sessionVersion', () => ({ forgetTokenVersion }));
vi.mock('@/lib/rateLimit', () => ({ consumeAllowance }));

const forgot = await import('@/app/api/auth/forgot-password/route');
const reset = await import('@/app/api/auth/reset-password/route');

describe('passwordProblem', () => {
    it.each([
        ['seven characters', 'abcdefg', 'Use at least 8 characters for your password.'],
        ['eight characters', 'abcdefgh', null],
        ['72 bytes', 'a'.repeat(72), null],
        ['73 bytes', 'a'.repeat(73), 'That password is too long. Use at most 72 characters.'],
        ['19 emoji (76 bytes)', '🔐'.repeat(19), 'That password is too long. Use at most 72 characters.'],
    ])('%s', (_, password, problem) => {
        expect(passwordProblem(password)).toBe(problem);
    });

    it('compares addresses in lower case, without spaces', () => {
        expect(normalizeEmail('  Alice@Example.COM ')).toBe('alice@example.com');
    });
});

describe('hitLocally', () => {
    beforeEach(() => clearLocalLimits());

    it('counts within a window and starts again in the next', () => {
        const window = 60_000;
        const start = 1_000 * window;
        for (let i = 0; i < 3; i++) expect(hitLocally('auth:1.2.3.4', 3, window, start + i).allowed).toBe(true);
        expect(hitLocally('auth:1.2.3.4', 3, window, start + 10)).toEqual({ allowed: false, resetMs: window - 10 });
        expect(hitLocally('auth:5.6.7.8', 3, window, start + 10).allowed).toBe(true);
        expect(hitLocally('auth:1.2.3.4', 3, window, start + window).allowed).toBe(true);
    });
});

describe('password reset links', () => {
    beforeEach(() => {
        prisma.$transaction.mockImplementation(async (arg: unknown) => (typeof arg === 'function' ? arg(tx) : Promise.all(arg as Promise<unknown>[])));
        prisma.passwordResetToken.deleteMany.mockResolvedValue({ count: 0 });
        prisma.passwordResetToken.create.mockResolvedValue({});
        tx.passwordResetToken.findUnique.mockResolvedValue({ id: 't1', email: 'alice@example.com' });
        tx.passwordResetToken.deleteMany.mockResolvedValue({ count: 1 });
        tx.user.findUnique.mockResolvedValue({ id: 'u1' });
        tx.user.update.mockResolvedValue({ id: 'u1' });
        tx.user.updateMany.mockResolvedValue({ count: 1 });
        emailTransport.mockReturnValue('smtp');
        consumeAllowance.mockResolvedValue({ outcome: 'allow', resetMs: 1_000 });
    });
    afterEach(() => vi.resetAllMocks());

    it('sends at most three reset emails an hour to one account, answering the same after', async () => {
        prisma.user.findFirst.mockResolvedValue({ id: 'u1', email: 'Alice@Example.com', password: 'hash' });
        consumeAllowance.mockResolvedValue({ outcome: 'deny', resetMs: 600_000 });

        const res = await forgot.POST(jsonRequest('http://localhost/api/auth/forgot-password', { email: 'alice@example.com' }));

        expect(await res.json()).toEqual({ message: 'If an account exists with that email, we sent a reset link.' });
        expect(consumeAllowance).toHaveBeenCalledWith('reset-mail:alice@example.com', 3, 60 * 60 * 1000);
        expect(sendPasswordResetEmail).not.toHaveBeenCalled();
        expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
    });

    it('says so when no email can be sent, the same for every address', async () => {
        emailTransport.mockReturnValue(null);

        const res = await forgot.POST(jsonRequest('http://localhost/api/auth/forgot-password', { email: 'alice@example.com' }));

        expect(res.status).toBe(503);
        expect(prisma.user.findFirst).not.toHaveBeenCalled();
    });

    it('keeps only a hash of the token; the email carries the token', async () => {
        prisma.user.findFirst.mockResolvedValue({ id: 'u1', email: 'alice@example.com', password: 'hash' });

        const res = await forgot.POST(jsonRequest('http://localhost/api/auth/forgot-password', { email: 'Alice@Example.com' }));

        expect(res.status).toBe(200);
        const sent = sendPasswordResetEmail.mock.calls[0][1] as string;
        const stored = prisma.passwordResetToken.create.mock.calls[0][0].data.token;
        expect(stored).toBe(hashSecretToken(sent));
        expect(stored).not.toBe(sent);
    });

    it('answers the same whether or not the account exists', async () => {
        prisma.user.findFirst.mockResolvedValue(null);

        const res = await forgot.POST(jsonRequest('http://localhost/api/auth/forgot-password', { email: 'nobody@example.com' }));

        expect(await res.json()).toEqual({ message: 'If an account exists with that email, we sent a reset link.' });
        expect(sendPasswordResetEmail).not.toHaveBeenCalled();
    });

    it('lets a link be used once', async () => {
        tx.passwordResetToken.deleteMany.mockResolvedValueOnce({ count: 0 });

        const res = await reset.POST(jsonRequest('http://localhost/api/auth/reset-password', { token: 'abc', password: 'a new password' }));

        expect(res.status).toBe(400);
        expect(tx.user.update).not.toHaveBeenCalled();
        expect(forgetTokenVersion).not.toHaveBeenCalled();
    });

    it('sets the password with a valid link, looking it up by hash', async () => {
        const res = await reset.POST(jsonRequest('http://localhost/api/auth/reset-password', { token: 'abc', password: 'a new password' }));

        expect(res.status).toBe(200);
        expect(tx.passwordResetToken.findUnique).toHaveBeenCalledWith({ where: { token: hashSecretToken('abc') } });
        expect(tx.user.findUnique).toHaveBeenCalledWith({ where: { email: 'alice@example.com' }, select: { id: true } });
        expect(tx.user.update.mock.calls[0][0].where).toEqual({ id: 'u1' });
    });

    it('ends every session the account had, and counts the emailed link as confirming the address', async () => {
        await reset.POST(jsonRequest('http://localhost/api/auth/reset-password', { token: 'abc', password: 'a new password' }));

        expect(tx.user.update.mock.calls[0][0].data).toMatchObject({ password: expect.any(String), tokenVersion: { increment: 1 } });
        expect(tx.user.updateMany).toHaveBeenCalledWith({ where: { id: 'u1', emailVerified: null }, data: { emailVerified: expect.any(Date) } });
        expect(forgetTokenVersion).toHaveBeenCalledWith('u1');
    });

    it('refuses a new password shorter than 8 characters', async () => {
        const res = await reset.POST(jsonRequest('http://localhost/api/auth/reset-password', { token: 'abc', password: 'short' }));

        expect(res.status).toBe(400);
        expect((await res.json()).error).toBe('Use at least 8 characters for your password.');
    });
});
