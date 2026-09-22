import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ids, jsonRequest } from '../../helpers/http';
import { runTransactionsOn } from '../../helpers/ledgerDb';

const { auth, prisma, tx } = vi.hoisted(() => ({
    auth: vi.fn(),
    prisma: {
        user: { findUnique: vi.fn() },
        transaction: { findFirst: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
        notification: { createMany: vi.fn() },
        $transaction: vi.fn(),
    },
    tx: {
        transaction: { updateMany: vi.fn() },
        splitItem: { deleteMany: vi.fn(), createMany: vi.fn() },
    },
}));

vi.mock('@/lib/auth', () => ({ auth }));
vi.mock('@/lib/db', () => ({ prisma }));
vi.mock('@/lib/auditLog', () => ({ createAuditLog: vi.fn() }));

const { PUT, DELETE } = await import('@/app/api/transactions/[id]/route');

const TXN = 'ctxn00000000001';
const SAVED_AT = new Date('2026-09-20T10:00:00.000Z');
const members = [ids.alice, ids.bob, ids.carol];

function existing(overrides: Record<string, unknown> = {}) {
    const splits = (overrides.splits as [string, number][] | undefined) ?? [[ids.alice, 300], [ids.bob, 300], [ids.carol, 300]];
    return {
        id: TXN,
        tripId: ids.trip,
        title: 'Dinner',
        amount: 900,
        splitType: 'equal',
        category: 'food',
        method: 'cash',
        description: null,
        payerId: ids.alice,
        createdAt: SAVED_AT,
        updatedAt: SAVED_AT,
        deletedAt: null,
        payer: { id: ids.alice, name: 'Alice' },
        trip: { id: ids.trip, title: 'Goa', group: { id: ids.group, name: 'Goa', members: members.map((userId) => ({ userId })) } },
        ...overrides,
        splits: splits.map(([userId, amount]) => ({ userId, amount, user: { id: userId, name: userId } })),
    };
}

const edit = (body: unknown) => PUT(
    jsonRequest(`http://localhost/api/transactions/${TXN}`, body, { method: 'PUT' }),
    { params: Promise.resolve({ id: TXN }) }
);
const remove = () => DELETE(new Request(`http://localhost/api/transactions/${TXN}`, { method: 'DELETE' }), { params: Promise.resolve({ id: TXN }) });

const savedShares = () => tx.splitItem.createMany.mock.calls[0][0].data.map((split: { userId: string; amount: number }) => [split.userId, split.amount]);

beforeEach(() => {
    auth.mockResolvedValue({ user: { email: 'alice@example.com' } });
    prisma.user.findUnique.mockResolvedValue({ id: ids.alice, name: 'Alice' });
    prisma.transaction.findFirst.mockResolvedValue(existing());
    prisma.transaction.findUnique.mockResolvedValue(existing());
    prisma.transaction.updateMany.mockResolvedValue({ count: 1 });
    prisma.notification.createMany.mockResolvedValue({ count: 2 });
    prisma.$transaction.mockImplementation(runTransactionsOn(tx));
    tx.transaction.updateMany.mockResolvedValue({ count: 1 });
    tx.splitItem.deleteMany.mockResolvedValue({ count: 3 });
    tx.splitItem.createMany.mockResolvedValue({ count: 3 });
});

afterEach(() => vi.clearAllMocks());

describe('PUT /api/transactions/:id', () => {
    it('re-splits a new amount among the same people, to the exact paisa', async () => {
        const res = await edit({ amount: 1_000 });

        expect(res.status).toBe(200);
        expect(savedShares()).toEqual([[ids.alice, 334], [ids.bob, 333], [ids.carol, 333]]);
        expect(tx.transaction.updateMany).toHaveBeenCalledWith({
            where: { id: TXN, deletedAt: null, updatedAt: SAVED_AT },
            data: { amount: 1_000, splitType: 'equal' },
        });
    });

    it('treats an empty pick of people as the whole group', async () => {
        prisma.transaction.findFirst.mockResolvedValue(existing({ splits: [[ids.alice, 450], [ids.bob, 450]] }));

        await edit({ splitAmong: [] });

        expect(savedShares()).toEqual([[ids.alice, 300], [ids.bob, 300], [ids.carol, 300]]);
    });

    it.each([
        ['someone outside the group', [ids.alice, ids.stranger], 'Everyone in the split must be a current member of the group'],
        ['the same person twice', [ids.alice, ids.alice], 'Each member can appear only once in a split'],
    ])('refuses a split with %s and writes nothing', async (_, splitAmong, error) => {
        const res = await edit({ splitAmong });

        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error });
        expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('refuses custom shares that no longer add up to the amount', async () => {
        const res = await edit({
            amount: 1_000,
            splitType: 'custom',
            splits: [{ userId: ids.alice, amount: 500 }, { userId: ids.bob, amount: 400 }],
        });

        expect(res.status).toBe(400);
        expect((await res.json()).error).toBe('Split amounts (900) must equal the transaction total (1000)');
    });

    it('refuses a new amount for a custom split without new shares', async () => {
        prisma.transaction.findFirst.mockResolvedValue(existing({ splitType: 'custom', splits: [[ids.alice, 600], [ids.bob, 300]] }));

        const res = await edit({ amount: 1_000 });

        expect(res.status).toBe(400);
        expect((await res.json()).error).toBe('Changing a custom split needs the new amount each member owes');
    });

    it('renames a custom-split expense even when the edit form sends the unchanged amount and people', async () => {
        prisma.transaction.findFirst.mockResolvedValue(existing({ splitType: 'custom', splits: [[ids.alice, 600], [ids.bob, 300]] }));

        const res = await edit({ title: 'Dinner at Thalassa', amount: 900, splitAmong: [ids.bob, ids.alice] });

        expect(res.status).toBe(200);
        expect(tx.transaction.updateMany.mock.calls[0][0].data).toEqual({ title: 'Dinner at Thalassa' });
        expect(tx.splitItem.createMany).not.toHaveBeenCalled();
    });

    it('says so when nothing would change', async () => {
        const res = await edit({ title: 'Dinner', amount: 900 });

        expect(res.status).toBe(400);
        expect((await res.json()).error).toBe('Nothing to change');
    });

    it('refuses to overwrite a version someone else saved after the editor opened it', async () => {
        const res = await edit({ amount: 1_000, expectedUpdatedAt: '2026-09-20T09:00:00.000Z' });

        expect(res.status).toBe(409);
        expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('refuses when another save lands between reading and writing', async () => {
        tx.transaction.updateMany.mockResolvedValue({ count: 0 });

        const res = await edit({ amount: 1_000 });

        expect(res.status).toBe(409);
        expect(tx.splitItem.deleteMany).not.toHaveBeenCalled();
    });

    it('only lets a current member who paid, or the owner, edit', async () => {
        prisma.transaction.findFirst.mockResolvedValue(null);

        const res = await edit({ amount: 1_000 });

        expect(res.status).toBe(404);
        const where = prisma.transaction.findFirst.mock.calls[0][0].where;
        expect(where.AND[0].trip.group).toEqual({
            deletedAt: null,
            OR: [{ ownerId: ids.alice }, { members: { some: { userId: ids.alice } } }],
        });
        expect(where.AND[1]).toEqual({ OR: [{ payerId: ids.alice }, { trip: { group: { ownerId: ids.alice } } }] });
    });

    it.each([
        ['a body that is not JSON', '{oops'],
        ['an amount over ₹10,00,000', JSON.stringify({ amount: 100_000_001 })],
        ['an amount past the 32-bit column', JSON.stringify({ amount: 2 ** 31 })],
    ])('answers %s with a readable 400', async (_, body) => {
        const res = await PUT(
            new Request(`http://localhost/api/transactions/${TXN}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body }),
            { params: Promise.resolve({ id: TXN }) }
        );

        expect(res.status).toBe(400);
        expect(typeof (await res.json()).error).toBe('string');
    });
});

describe('DELETE /api/transactions/:id', () => {
    it('soft-deletes the expense once', async () => {
        const res = await remove();

        expect(res.status).toBe(200);
        expect(prisma.transaction.updateMany).toHaveBeenCalledWith({
            where: { id: TXN, deletedAt: null },
            data: { deletedAt: expect.any(Date) },
        });
    });

    it('reports a delete that lost the race as not found, and records nothing', async () => {
        prisma.transaction.updateMany.mockResolvedValue({ count: 0 });
        const { createAuditLog } = await import('@/lib/auditLog');

        const res = await remove();

        expect(res.status).toBe(404);
        expect(createAuditLog).not.toHaveBeenCalled();
    });

    it('uses the same rule as editing: a current member who paid, or the owner', async () => {
        prisma.transaction.findFirst.mockResolvedValue(null);

        const res = await remove();

        expect(res.status).toBe(404);
        expect(prisma.transaction.findFirst.mock.calls[0][0].where.AND[0].trip.group.deletedAt).toBeNull();
        expect(prisma.transaction.updateMany).not.toHaveBeenCalled();
    });
});
