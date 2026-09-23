import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ids } from '../../helpers/http';

/*
 * A deleted group is gone for everyone in it: its expenses, its search results
 * and its chat. Three reads used to check membership without checking that the
 * group still exists.
 */

const { auth, prisma } = vi.hoisted(() => ({
    auth: vi.fn(),
    prisma: {
        user: { findUnique: vi.fn() },
        group: { findFirst: vi.fn(), findMany: vi.fn() },
        transaction: { findFirst: vi.fn(), findMany: vi.fn() },
        groupMessage: { findMany: vi.fn() },
    },
}));
vi.mock('@/lib/auth', () => ({ auth }));
vi.mock('@/lib/db', () => ({ prisma }));

const expense = await import('@/app/api/transactions/[id]/route');
const search = await import('@/app/api/search/route');
const messages = await import('@/app/api/groups/[groupId]/messages/route');

beforeEach(() => {
    auth.mockResolvedValue({ user: { email: 'alice@example.com' } });
    prisma.user.findUnique.mockResolvedValue({ id: ids.alice });
    prisma.group.findFirst.mockResolvedValue(null);
    prisma.group.findMany.mockResolvedValue([]);
    prisma.transaction.findFirst.mockResolvedValue(null);
    prisma.transaction.findMany.mockResolvedValue([]);
    prisma.groupMessage.findMany.mockResolvedValue([]);
});
afterEach(() => vi.resetAllMocks());

describe('reads of a deleted group', () => {
    it('one expense: only from a group that still exists', async () => {
        const res = await expense.GET(new Request('http://localhost/api/transactions/t1'), { params: Promise.resolve({ id: 't1' }) });

        expect(res.status).toBe(404);
        expect(prisma.transaction.findFirst.mock.calls[0][0].where.trip.group.deletedAt).toBeNull();
    });

    it('search: no expenses from a deleted group', async () => {
        await search.GET(new Request('http://localhost/api/search?q=dinner'));

        expect(prisma.transaction.findMany.mock.calls[0][0].where.trip.group.deletedAt).toBeNull();
    });

    it('chat: a deleted group’s messages are gone too', async () => {
        const res = await messages.GET(new Request(`http://localhost/api/groups/${ids.group}/messages`), { params: Promise.resolve({ groupId: ids.group }) });

        expect(res.status).toBe(403);
        expect(prisma.group.findFirst.mock.calls[0][0].where.deletedAt).toBeNull();
        expect(prisma.groupMessage.findMany).not.toHaveBeenCalled();
    });
});
