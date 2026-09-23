import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ids, jsonRequest } from '../../helpers/http';

const { auth, prisma } = vi.hoisted(() => ({
    auth: vi.fn(),
    prisma: { user: { update: vi.fn() } },
}));
vi.mock('@/lib/auth', () => ({ auth }));
vi.mock('@/lib/db', () => ({ prisma }));

const { PATCH } = await import('@/app/api/me/route');

const update = (body: Record<string, unknown>) => PATCH(jsonRequest('http://localhost/api/me', body, { method: 'PATCH' }));

beforeEach(() => {
    auth.mockResolvedValue({ user: { email: 'alice@example.com' } });
    prisma.user.update.mockImplementation(async ({ data }) => ({ id: ids.alice, email: 'alice@example.com', ...data }));
});
afterEach(() => vi.resetAllMocks());

describe('PATCH /api/me', () => {
    it('never takes a profile photo from a URL someone types (a tracking pixel every group member would load)', async () => {
        const res = await update({ name: 'Alice', image: 'https://tracker.example/pixel.gif' });

        expect(res.status).toBe(200);
        expect(prisma.user.update.mock.calls[0][0].data).toEqual({ name: 'Alice' });
    });

    it('still saves the name, phone and UPI ID', async () => {
        await update({ name: 'Alice K', phone: '+91 98765 43210', upiId: 'alice@okbank' });

        expect(prisma.user.update.mock.calls[0][0].data).toEqual({ name: 'Alice K', phone: '+91 98765 43210', upiId: 'alice@okbank' });
    });
});
