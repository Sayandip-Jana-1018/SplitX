import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { ids, jsonRequest } from '../../helpers/http';
import { ledgerQueries, runTransactionsOn, type LedgerFixture } from '../../helpers/ledgerDb';

const { auth, prisma, tx, createNotification } = vi.hoisted(() => {
    const ledgerReads = () => ({
        group: { findMany: vi.fn() },
        transaction: { findMany: vi.fn() },
        user: { findMany: vi.fn() },
    });
    return {
        auth: vi.fn(),
        prisma: {
            ...ledgerReads(),
            user: { findUnique: vi.fn(), findMany: vi.fn() },
            trip: { findFirst: vi.fn() },
            settlement: { findFirst: vi.fn(), findMany: vi.fn() },
            $transaction: vi.fn(),
        },
        tx: {
            ...ledgerReads(),
            settlement: { findMany: vi.fn(), create: vi.fn() },
        },
        createNotification: vi.fn(),
    };
});

vi.mock('@/lib/auth', () => ({ auth }));
vi.mock('@/lib/db', () => ({ prisma }));
vi.mock('@/lib/auditLog', () => ({ createAuditLog: vi.fn() }));
vi.mock('@/lib/notifications', () => ({ createNotification }));

const settlementsRoute = await import('@/app/api/settlements/route');
const byGroupRoute = await import('@/app/api/settlements/by-group/route');

const OLD_TRIP = 'ctripold0000001';
const names: Record<string, string> = { [ids.alice]: 'Alice', [ids.bob]: 'Bob', [ids.carol]: 'Carol' };

/*
 * Alice paid ₹9 for three people on the group's older trip; the newer trip is
 * the active one, where Settle Up records payments. Carol owes Alice ₹3.
 */
const goa: LedgerFixture = {
    groupId: ids.group,
    ownerId: ids.alice,
    memberIds: [ids.alice, ids.bob, ids.carol],
    names,
    trips: [{ id: OLD_TRIP, isActive: false, day: 1 }, { id: ids.trip, isActive: true, day: 2 }],
    transactions: [
        { id: 't1', tripId: OLD_TRIP, payerId: ids.alice, amount: 900, splits: [[ids.alice, 300], [ids.bob, 300], [ids.carol, 300]] },
        { id: 't2', tripId: ids.trip, payerId: ids.bob, amount: 600, splits: [[ids.alice, 300], [ids.bob, 300]] },
    ],
};

function useGroup(fixture: LedgerFixture) {
    const queries = ledgerQueries(fixture);
    for (const client of [prisma, tx]) {
        client.group.findMany.mockImplementation(queries.group.findMany);
        client.transaction.findMany.mockImplementation(queries.transaction.findMany);
        client.user.findMany.mockImplementation(queries.user.findMany);
        client.settlement.findMany.mockImplementation(queries.settlement.findMany);
    }
}

function signIn(userId: string) {
    auth.mockResolvedValue({ user: { email: `${userId}@example.com` } });
    prisma.user.findUnique.mockResolvedValue({ id: userId, name: names[userId], email: `${userId}@example.com` });
}

const pay = (body: Record<string, unknown>) => settlementsRoute.POST(
    jsonRequest('http://localhost/api/settlements', { tripId: ids.trip, method: 'upi', ...body })
);

beforeEach(() => {
    prisma.trip.findFirst.mockResolvedValue({
        id: ids.trip,
        title: 'Goa, day 2',
        groupId: ids.group,
        group: { id: ids.group, ownerId: ids.alice, members: [ids.alice, ids.bob, ids.carol].map((userId) => ({ userId })) },
    });
    prisma.settlement.findFirst.mockResolvedValue(null);
    prisma.$transaction.mockImplementation(runTransactionsOn(tx));
    tx.settlement.create.mockImplementation(async ({ data }: { data: { fromId: string; toId: string; tripId: string } }) => ({
        id: 'csettle00000001',
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        from: { name: names[data.fromId] },
        to: { name: names[data.toId] },
        trip: { id: data.tripId, title: 'Goa, day 2', groupId: ids.group },
    }));
    useGroup(goa);
    signIn(ids.carol);
});

afterEach(() => vi.resetAllMocks());

describe('POST /api/settlements', () => {
    it('accepts paying off a debt that was run up on another trip of the group', async () => {
        const res = await pay({ toUserId: ids.alice, amount: 300 });

        expect(res.status).toBe(201);
        expect(tx.settlement.create.mock.calls[0][0].data).toMatchObject({
            tripId: ids.trip, fromId: ids.carol, toId: ids.alice, amount: 300, status: 'pending',
        });
        expect(prisma.$transaction.mock.calls[0][1]).toEqual({ isolationLevel: 'Serializable' });
    });

    it('refuses more than the payer owes, naming the exact balance', async () => {
        const res = await pay({ toUserId: ids.alice, amount: 301 });

        expect(res.status).toBe(400);
        expect((await res.json()).error).toBe('Settlement amount exceeds what you owe. Your net balance is ₹3 in this group.');
        expect(tx.settlement.create).not.toHaveBeenCalled();
    });

    it('counts payments already waiting for approval', async () => {
        useGroup({ ...goa, settlements: [{ id: 's1', tripId: OLD_TRIP, fromId: ids.carol, toId: ids.alice, amount: 200, status: 'paid_pending' }] });

        const tooMuch = await pay({ toUserId: ids.alice, amount: 300 });
        expect(tooMuch.status).toBe(400);
        expect((await tooMuch.json()).error).toBe('Only ₹1 is left to settle once the payments already waiting are approved.');

        const rest = await pay({ toUserId: ids.alice, amount: 100 });
        expect(rest.status).toBe(201);
    });

    it('refuses paying someone the group owes nothing', async () => {
        const res = await pay({ toUserId: ids.bob, amount: 100 });

        expect(res.status).toBe(400);
        expect((await res.json()).error).toBe('Bob isn’t owed anything in this group.');
    });

    it('refuses a payment from someone who owes nothing', async () => {
        signIn(ids.bob);

        const res = await pay({ toUserId: ids.alice, amount: 100 });

        expect(res.status).toBe(400);
        expect((await res.json()).error).toBe('You don’t owe anything in this group.');
    });

    it('lets the receiver record cash they were handed, within what is owed', async () => {
        signIn(ids.alice);

        const res = await pay({ toUserId: ids.alice, fromUserId: ids.carol, amount: 300, method: 'cash' });

        expect(res.status).toBe(201);
        expect(createNotification).not.toHaveBeenCalled();
    });

    it('hands back a request already open for the same payment on any trip of the group', async () => {
        prisma.settlement.findFirst.mockResolvedValueOnce({ id: 'copen0000000001', status: 'initiated' });

        const res = await pay({ toUserId: ids.alice, amount: 300 });

        expect(res.status).toBe(200);
        expect((await res.json()).id).toBe('copen0000000001');
        expect(prisma.settlement.findFirst.mock.calls[0][0].where.trip).toEqual({ groupId: ids.group });
        expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('asks to try again when a change at the same moment wins', async () => {
        prisma.$transaction.mockRejectedValue(
            new Prisma.PrismaClientKnownRequestError('write conflict', { code: 'P2034', clientVersion: 'test' })
        );

        const res = await pay({ toUserId: ids.alice, amount: 300 });

        expect(res.status).toBe(409);
    });

    it.each([
        ['a body that is not JSON', '{oops'],
        ['an amount past the 32-bit column', JSON.stringify({ tripId: ids.trip, toUserId: ids.alice, amount: 2 ** 31 })],
    ])('answers %s with a readable 400', async (_, body) => {
        const res = await settlementsRoute.POST(
            new Request('http://localhost/api/settlements', { method: 'POST', headers: { 'content-type': 'application/json' }, body })
        );

        expect(res.status).toBe(400);
        expect(typeof (await res.json()).error).toBe('string');
    });

    it('does not accept a trip from a deleted group', async () => {
        await pay({ toUserId: ids.alice, amount: 300 });
        expect(prisma.trip.findFirst.mock.calls[0][0].where.group).toEqual({ deletedAt: null });
    });
});

describe('GET /api/settlements/by-group', () => {
    it('plans each group over all its trips and records payments on the active trip', async () => {
        const res = await byGroupRoute.GET();
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.groups).toHaveLength(1);
        expect(body.groups[0].tripId).toBe(ids.trip);
        expect(body.groups[0].computed).toEqual([
            expect.objectContaining({ from: ids.carol, to: ids.alice, amount: 300, tripId: ids.trip, groupId: ids.group }),
        ]);
        expect(body.global.computed).toEqual(body.groups[0].computed);
    });
});

describe('GET /api/settlements', () => {
    it('answers ?tripId= for the whole group the trip belongs to', async () => {
        prisma.trip.findFirst.mockResolvedValue({ groupId: ids.group });

        const res = await settlementsRoute.GET(new Request(`http://localhost/api/settlements?tripId=${OLD_TRIP}`));
        const body = await res.json();

        expect(body.balances).toEqual({ [ids.alice]: 300, [ids.bob]: 0, [ids.carol]: -300 });
        expect(body.computed).toEqual([expect.objectContaining({ from: ids.carol, to: ids.alice, amount: 300, tripId: OLD_TRIP })]);
    });

    it('refuses a trip the caller cannot see', async () => {
        prisma.trip.findFirst.mockResolvedValue(null);

        const res = await settlementsRoute.GET(new Request(`http://localhost/api/settlements?tripId=${OLD_TRIP}`));

        expect(res.status).toBe(404);
    });
});
