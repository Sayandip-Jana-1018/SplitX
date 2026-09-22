import { afterEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

const { prisma, auth, forgetTokenVersion } = vi.hoisted(() => ({
    prisma: { user: { update: vi.fn() } },
    auth: vi.fn(),
    forgetTokenVersion: vi.fn(),
}));
vi.mock('@/lib/db', () => ({ prisma }));
vi.mock('@/lib/auth', () => ({ auth }));
vi.mock('@/lib/sessionVersion', () => ({ forgetTokenVersion }));

const { DELETE } = await import('@/app/api/me/sessions/route');

afterEach(() => vi.resetAllMocks());

describe('DELETE /api/me/sessions (sign out of all devices)', () => {
    it('raises the account’s version, and forgets the old one on this server at once', async () => {
        auth.mockResolvedValue({ user: { email: 'alice@example.com' } });
        prisma.user.update.mockResolvedValue({ id: 'u1' });

        const res = await DELETE();

        expect(res.status).toBe(200);
        expect(prisma.user.update).toHaveBeenCalledWith({
            where: { email: 'alice@example.com' },
            data: { tokenVersion: { increment: 1 } },
            select: { id: true },
        });
        expect(forgetTokenVersion).toHaveBeenCalledWith('u1');
    });

    it('needs a session, and says so when the account is gone', async () => {
        auth.mockResolvedValue(null);
        expect((await DELETE()).status).toBe(401);

        auth.mockResolvedValue({ user: { email: 'gone@example.com' } });
        prisma.user.update.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('No record', { code: 'P2025', clientVersion: 'test' }));
        expect((await DELETE()).status).toBe(404);
    });
});
