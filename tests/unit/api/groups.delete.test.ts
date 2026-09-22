import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ids } from '../../helpers/http';
import { ledgerQueries, runTransactionsOn, type LedgerFixture } from '../../helpers/ledgerDb';

const { auth, prisma, tx } = vi.hoisted(() => ({
    auth: vi.fn(),
    prisma: {
        user: { findUnique: vi.fn() },
        group: { findFirst: vi.fn() },
        notification: { createMany: vi.fn() },
        $transaction: vi.fn(),
    },
    tx: {
        group: { findMany: vi.fn(), update: vi.fn() },
        transaction: { findMany: vi.fn(), updateMany: vi.fn() },
        settlement: { findMany: vi.fn() },
        user: { findMany: vi.fn() },
        notification: { deleteMany: vi.fn() },
    },
}));

vi.mock('@/lib/auth', () => ({ auth }));
vi.mock('@/lib/db', () => ({ prisma }));
vi.mock('@/lib/auditLog', () => ({ createAuditLog: vi.fn() }));

const { DELETE } = await import('@/app/api/groups/[groupId]/route');

const goa: LedgerFixture = {
    groupId: ids.group,
    ownerId: ids.alice,
    memberIds: [ids.alice, ids.bob],
    names: { [ids.alice]: 'Alice', [ids.bob]: 'Bob' },
    trips: [{ id: ids.trip, isActive: true, day: 1 }],
};

function useLedger(fixture: Partial<LedgerFixture>) {
    const queries = ledgerQueries({ ...goa, ...fixture });
    tx.group.findMany.mockImplementation(queries.group.findMany);
    tx.transaction.findMany.mockImplementation(queries.transaction.findMany);
    tx.settlement.findMany.mockImplementation(queries.settlement.findMany);
    tx.user.findMany.mockImplementation(queries.user.findMany);
}

const deleteGroup = () => DELETE(
    new Request(`http://localhost/api/groups/${ids.group}`, { method: 'DELETE' }),
    { params: Promise.resolve({ groupId: ids.group }) }
);

beforeEach(() => {
    auth.mockResolvedValue({ user: { email: 'alice@example.com' } });
    prisma.user.findUnique.mockResolvedValue({ id: ids.alice, name: 'Alice' });
    prisma.group.findFirst.mockResolvedValue({
        id: ids.group,
        name: 'Goa',
        ownerId: ids.alice,
        members: [{ userId: ids.alice, user: { id: ids.alice, name: 'Alice' } }, { userId: ids.bob, user: { id: ids.bob, name: 'Bob' } }],
        trips: [{ id: ids.trip }],
    });
    prisma.$transaction.mockImplementation(runTransactionsOn(tx));
    prisma.notification.createMany.mockResolvedValue({ count: 1 });
    tx.group.update.mockResolvedValue({});
    tx.transaction.updateMany.mockResolvedValue({ count: 0 });
    tx.notification.deleteMany.mockResolvedValue({ count: 0 });
});

afterEach(() => vi.resetAllMocks());

describe('DELETE /api/groups/:groupId', () => {
    it('refuses while anyone still owes money, so a delete can never wipe out a debt', async () => {
        useLedger({ transactions: [{ id: 't1', tripId: ids.trip, payerId: ids.bob, amount: 1_000, splits: [[ids.alice, 500], [ids.bob, 500]] }] });

        const res = await deleteGroup();

        expect(res.status).toBe(409);
        expect((await res.json()).error).toBe('2 people still owe or are owed ₹5 in this group. Settle up first, then delete it.');
        expect(tx.group.update).not.toHaveBeenCalled();
    });

    it('refuses while a payment is still waiting', async () => {
        useLedger({ settlements: [{ id: 's1', tripId: ids.trip, fromId: ids.alice, toId: ids.bob, amount: 500, status: 'initiated' }] });

        const res = await deleteGroup();

        expect(res.status).toBe(409);
        expect((await res.json()).error).toBe('Some payments in this group are still waiting. Complete or cancel them first, then delete it.');
    });

    it('deletes a settled group', async () => {
        useLedger({
            transactions: [{ id: 't1', tripId: ids.trip, payerId: ids.bob, amount: 1_000, splits: [[ids.alice, 500], [ids.bob, 500]] }],
            settlements: [{ id: 's1', tripId: ids.trip, fromId: ids.alice, toId: ids.bob, amount: 500, status: 'completed' }],
        });

        const res = await deleteGroup();

        expect(res.status).toBe(200);
        expect(tx.group.update).toHaveBeenCalledWith({ where: { id: ids.group }, data: { deletedAt: expect.any(Date) } });
        expect(prisma.$transaction.mock.calls[0][1]).toEqual({ isolationLevel: 'Serializable' });
    });

    it('lets only the owner delete', async () => {
        prisma.user.findUnique.mockResolvedValue({ id: ids.bob, name: 'Bob' });

        const res = await deleteGroup();

        expect(res.status).toBe(403);
        expect(prisma.$transaction).not.toHaveBeenCalled();
    });
});
