import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ids } from '../../helpers/http';

const { auth, prisma } = vi.hoisted(() => ({
    auth: vi.fn(),
    prisma: {
        user: { findUnique: vi.fn() },
        group: { findFirst: vi.fn() },
        transaction: { findMany: vi.fn() },
        settlement: { findMany: vi.fn() },
        auditLog: { findMany: vi.fn() },
    },
}));

vi.mock('@/lib/auth', () => ({ auth }));
vi.mock('@/lib/db', () => ({ prisma }));

const { GET } = await import('@/app/api/groups/[groupId]/balance-history/route');

const at = new Date('2026-09-20T10:00:00Z');
const expense = (id: string) => ({
    id,
    tripId: ids.trip,
    title: `Expense ${id}`,
    amount: 600,
    splitType: 'equal',
    payerId: ids.alice,
    createdAt: at,
    updatedAt: at,
    deletedAt: null,
    payer: { id: ids.alice, name: 'Alice' },
    splits: [
        { userId: ids.alice, amount: 300, user: { id: ids.alice, name: 'Alice' } },
        { userId: ids.bob, amount: 300, user: { id: ids.bob, name: 'Bob' } },
    ],
});

const history = () => GET(
    new Request(`http://localhost/api/groups/${ids.group}/balance-history?limit=10`),
    { params: Promise.resolve({ groupId: ids.group }) }
);

beforeEach(() => {
    auth.mockResolvedValue({ user: { email: 'alice@example.com' } });
    prisma.user.findUnique.mockResolvedValue({ id: ids.alice, name: 'Alice' });
    prisma.group.findFirst.mockResolvedValue({
        id: ids.group,
        name: 'Goa',
        emoji: '🏖️',
        createdAt: at,
        members: [ids.alice, ids.bob].map((id) => ({ role: 'member', user: { id, name: id === ids.alice ? 'Alice' : 'Bob', image: null, upiId: null } })),
        trips: [{ id: ids.trip, title: 'Goa' }],
    });
    prisma.transaction.findMany.mockResolvedValue([expense('ctxn00000000001'), expense('ctxn00000000002')]);
    prisma.settlement.findMany.mockResolvedValue([]);
    prisma.auditLog.findMany.mockResolvedValue([]);
});

afterEach(() => vi.resetAllMocks());

describe('GET /api/groups/:groupId/balance-history', () => {
    it("reads the audit logs of this group's expenses only", async () => {
        const res = await history();

        expect(res.status).toBe(200);
        expect(prisma.auditLog.findMany).toHaveBeenCalledWith({
            where: { entityType: 'transaction', entityId: { in: ['ctxn00000000001', 'ctxn00000000002'] } },
            orderBy: { createdAt: 'asc' },
        });
    });

    it('skips the audit log entirely for a group with no expenses', async () => {
        prisma.transaction.findMany.mockResolvedValue([]);

        await history();

        expect(prisma.auditLog.findMany).not.toHaveBeenCalled();
    });

    it('still explains what each expense did to the balance', async () => {
        const body = await (await history()).json();

        expect(body.currentBalance).toBe(600);
        expect(body.entries).toHaveLength(2);
    });
});
