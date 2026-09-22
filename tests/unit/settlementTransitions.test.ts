import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { ids } from '../helpers/http';
import { ledgerQueries, runTransactionsOn, type LedgerFixture } from '../helpers/ledgerDb';

const { prisma, tx, createAuditLog } = vi.hoisted(() => ({
    prisma: { $transaction: vi.fn() },
    tx: {
        settlement: { findFirst: vi.fn(), updateMany: vi.fn(), findUniqueOrThrow: vi.fn(), findMany: vi.fn() },
        group: { findMany: vi.fn() },
        transaction: { findMany: vi.fn() },
        user: { findMany: vi.fn() },
    },
    createAuditLog: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ prisma }));
vi.mock('@/lib/auditLog', () => ({ createAuditLog }));

const { SETTLEMENT_TRANSITIONS, transitionSettlement, TransitionRefused } = await import('@/lib/settlementTransitions');
type Action = keyof typeof SETTLEMENT_TRANSITIONS;

const STATUSES = ['pending', 'initiated', 'paid_pending', 'completed', 'confirmed', 'cancelled'];
const SETTLEMENT = 'csettle00000001';

// Carol owes Alice ₹3 in the group; the settlement under test is Carol paying Alice.
const goa: LedgerFixture = {
    groupId: ids.group,
    ownerId: ids.alice,
    memberIds: [ids.alice, ids.bob, ids.carol],
    names: { [ids.alice]: 'Alice', [ids.bob]: 'Bob', [ids.carol]: 'Carol' },
    trips: [{ id: ids.trip, isActive: true, day: 1 }],
    transactions: [{ id: 't1', tripId: ids.trip, payerId: ids.alice, amount: 900, splits: [[ids.alice, 300], [ids.bob, 300], [ids.carol, 300]] }],
};

function row(status: string, amount = 300) {
    return {
        id: SETTLEMENT,
        tripId: ids.trip,
        fromId: ids.carol,
        toId: ids.alice,
        amount,
        status,
        method: 'upi',
        note: null,
        utrNumber: null,
        createdAt: new Date('2026-09-20T10:00:00Z'),
        updatedAt: new Date('2026-09-20T10:00:00Z'),
        deletedAt: null,
        from: { id: ids.carol, name: 'Carol', upiId: null },
        to: { id: ids.alice, name: 'Alice', upiId: 'alice@upi' },
        trip: { id: ids.trip, title: 'Goa', groupId: ids.group },
    };
}

function useLedger(fixture: LedgerFixture) {
    const queries = ledgerQueries(fixture);
    tx.group.findMany.mockImplementation(queries.group.findMany);
    tx.transaction.findMany.mockImplementation(queries.transaction.findMany);
    tx.settlement.findMany.mockImplementation(queries.settlement.findMany);
    tx.user.findMany.mockImplementation(queries.user.findMany);
}

function settlementIn(status: string, amount = 300) {
    tx.settlement.findFirst.mockResolvedValue(row(status, amount));
    tx.settlement.findUniqueOrThrow.mockImplementation(async () => ({
        ...row(status, amount),
        status: tx.settlement.updateMany.mock.calls.at(-1)?.[0].data.status ?? status,
    }));
}

const move = (action: Action, actorId: string) => transitionSettlement({ settlementId: SETTLEMENT, actorId, action });

async function refusal(promise: Promise<unknown>) {
    const error = await promise.then(() => null, (caught: unknown) => caught);
    expect(error).toBeInstanceOf(TransitionRefused);
    return error as InstanceType<typeof TransitionRefused>;
}

beforeEach(() => {
    prisma.$transaction.mockImplementation(runTransactionsOn(tx));
    tx.settlement.updateMany.mockResolvedValue({ count: 1 });
    useLedger(goa);
});

afterEach(() => vi.resetAllMocks());

describe('the transition table', () => {
    const cases = (Object.keys(SETTLEMENT_TRANSITIONS) as Action[]).flatMap((action) =>
        STATUSES.map((status) => [action, status] as const)
    );

    it.each(cases)('%s from %s: allowed only from the states it lists', async (action, status) => {
        settlementIn(status);
        const rule = SETTLEMENT_TRANSITIONS[action];
        const actor = rule.by === 'payer' ? ids.carol : ids.alice;
        const allowed = (rule.from as readonly string[]).includes(status);

        if (allowed) {
            const { after } = await move(action, actor);
            expect(after.status).toBe(rule.to);
            expect(tx.settlement.updateMany).toHaveBeenCalledWith({
                where: { id: SETTLEMENT, status, deletedAt: null },
                data: { status: rule.to },
            });
        } else {
            expect((await refusal(move(action, actor))).status).toBe(409);
            expect(tx.settlement.updateMany).not.toHaveBeenCalled();
        }
    });

    it('never completes a request that was marked as not paid', async () => {
        settlementIn('cancelled');

        const error = await refusal(move('accept_cash', ids.alice));

        expect(error.message).toBe('This request was marked as not paid. Start a new one from Settle Up.');
    });

    it.each(Object.keys(SETTLEMENT_TRANSITIONS) as Action[])('%s: only the person it names may do it', async (action) => {
        settlementIn('paid_pending');
        const rule = SETTLEMENT_TRANSITIONS[action];
        const wrongPerson = rule.by === 'payer' ? ids.alice : ids.carol;

        for (const actor of [wrongPerson, ids.bob]) {
            expect((await refusal(move(action, actor))).status).toBe(403);
        }
        expect(tx.settlement.updateMany).not.toHaveBeenCalled();
    });
});

describe('transitionSettlement', () => {
    it('lets exactly one of two taps at once land', async () => {
        settlementIn('paid_pending');
        tx.settlement.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });

        const results = await Promise.allSettled([move('approve', ids.alice), move('approve', ids.alice)]);

        expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
        const lost = results.find((result) => result.status === 'rejected') as PromiseRejectedResult;
        expect(lost.reason.message).toBe('This payment changed at the same moment. Refresh and try again.');
        expect(createAuditLog).toHaveBeenCalledTimes(1);
    });

    it('writes every move to the audit log, with the state before and after', async () => {
        settlementIn('pending');

        await move('decline', ids.alice);

        expect(createAuditLog).toHaveBeenCalledWith(expect.objectContaining({
            userId: ids.alice,
            action: 'update',
            entityType: 'settlement',
            entityId: SETTLEMENT,
            details: expect.objectContaining({
                groupId: ids.group,
                transition: 'decline',
                before: expect.objectContaining({ status: 'pending' }),
                after: expect.objectContaining({ status: 'cancelled' }),
            }),
        }));
    });

    it('stops the payer paying a request the balances no longer support', async () => {
        settlementIn('pending', 500);

        const error = await refusal(move('mark_paid', ids.carol));

        expect(error).toMatchObject({ status: 409, code: 'balance_changed' });
        expect(error.message).toBe(
            'Balances have changed since this request was made. It is for ₹5, and ₹3 is left to settle between you now. '
            + 'Ask Alice to mark it as not paid, then settle the new amount.'
        );
        expect(prisma.$transaction.mock.calls[0][1]).toEqual({ isolationLevel: 'Serializable' });
    });

    it('does not count the request being paid against itself', async () => {
        useLedger({ ...goa, settlements: [{ id: SETTLEMENT, tripId: ids.trip, fromId: ids.carol, toId: ids.alice, amount: 300, status: 'pending' }] });
        settlementIn('pending');

        const { after } = await move('open_upi', ids.carol);

        expect(after.status).toBe('initiated');
    });

    it('records what the receiver says arrived without second-guessing it', async () => {
        settlementIn('paid_pending', 500);

        const { after } = await move('approve', ids.alice);

        expect(after.status).toBe('completed');
        expect(tx.group.findMany).not.toHaveBeenCalled();
    });

    it('treats a settlement as gone once its group is deleted or the person has left it', async () => {
        tx.settlement.findFirst.mockResolvedValue(null);

        expect((await refusal(move('approve', ids.alice))).status).toBe(404);
        await move('approve', ids.alice).catch(() => undefined);
        expect(tx.settlement.findFirst.mock.calls[0][0].where).toEqual({
            id: SETTLEMENT,
            deletedAt: null,
            trip: { group: { deletedAt: null, OR: [{ ownerId: ids.alice }, { members: { some: { userId: ids.alice } } }] } },
        });
    });

    it('asks to try again when a serializable check loses to a change at the same moment', async () => {
        settlementIn('pending');
        prisma.$transaction.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('conflict', { code: 'P2034', clientVersion: 'test' }));

        expect((await refusal(move('mark_paid', ids.carol))).status).toBe(409);
    });
});
