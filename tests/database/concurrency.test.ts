import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { jsonRequest } from '../helpers/http';
import { emptyDatabase, expense, groupOf, person, sessionOf } from './fixtures';

// Two people (or one person's two taps) acting at the same moment, through the
// real code paths and a real Postgres: row locks, serializable transactions and
// unique constraints are what decide these, and a mock database has none of them.
// Rounds repeat each race so that more than one interleaving gets exercised.

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock('@/lib/auth', () => ({ auth }));

const { transitionSettlement, TransitionRefused } = await import('@/lib/settlementTransitions');
const settlements = await import('@/app/api/settlements/route');
const expenseRoute = await import('@/app/api/transactions/[id]/route');
const join = await import('@/app/api/groups/join/route');

beforeEach(emptyDatabase);
afterAll(() => prisma.$disconnect());

/** A fresh group where Bob owes Alice ₹100. */
async function bobOwesAlice() {
    const [alice, bob] = [await person('Alice'), await person('Bob')];
    const { group, trip } = await groupOf(alice, [bob]);
    await expense(trip.id, alice, 20_000, [alice, bob]);
    return { alice, bob, group, trip };
}

const refusal = (results: PromiseSettledResult<unknown>[]) =>
    (results.find((result) => result.status === 'rejected') as PromiseRejectedResult).reason;

describe('one payment, moved twice at once', () => {
    it('approve and decline together: exactly one happens, and only it is in the history', async () => {
        for (let round = 0; round < 5; round++) {
            const { alice, bob, trip } = await bobOwesAlice();
            const payment = await prisma.settlement.create({
                data: { tripId: trip.id, fromId: bob.id, toId: alice.id, amount: 10_000, status: 'paid_pending' },
            });

            const results = await Promise.allSettled([
                transitionSettlement({ settlementId: payment.id, actorId: alice.id, action: 'approve' }),
                transitionSettlement({ settlementId: payment.id, actorId: alice.id, action: 'decline' }),
            ]);

            expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
            expect(refusal(results)).toBeInstanceOf(TransitionRefused);
            expect(refusal(results).status).toBe(409);
            const approved = results[0].status === 'fulfilled';
            const saved = await prisma.settlement.findUniqueOrThrow({ where: { id: payment.id } });
            expect(saved.status).toBe(approved ? 'completed' : 'cancelled');
            const history = await prisma.auditLog.findMany({ where: { entityType: 'settlement', entityId: payment.id } });
            expect(history.map((entry) => (entry.details as { transition?: string }).transition)).toEqual([approved ? 'approve' : 'decline']);
        }
    });

    it('a double tap on "I have paid": one moves it, the other is told it already has', async () => {
        for (let round = 0; round < 5; round++) {
            const { alice, bob, trip } = await bobOwesAlice();
            const payment = await prisma.settlement.create({ data: { tripId: trip.id, fromId: bob.id, toId: alice.id, amount: 10_000 } });

            const results = await Promise.allSettled([1, 2].map(() =>
                transitionSettlement({ settlementId: payment.id, actorId: bob.id, action: 'mark_paid' })));

            expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
            expect(refusal(results)).toBeInstanceOf(TransitionRefused);
            expect(refusal(results).status).toBe(409);
            expect((await prisma.settlement.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('paid_pending');
            expect(await prisma.auditLog.count({ where: { entityType: 'settlement', entityId: payment.id } })).toBe(1);
        }
    });
});

describe('payments started at the same moment', () => {
    it('never add up to more than is owed, and every refusal is an answer, not an error', async () => {
        for (let round = 0; round < 3; round++) {
            const { alice, bob, trip } = await bobOwesAlice();
            auth.mockResolvedValue(sessionOf(bob));

            // Bob owes ₹100. Each of these fits on its own; no four of them do.
            const amounts = [3_000, 3_100, 3_200, 3_300, 3_400];
            const responses = await Promise.all(amounts.map((amount) => settlements.POST(jsonRequest('http://localhost/api/settlements', {
                tripId: trip.id, toUserId: alice.id, amount, method: 'upi',
            }))));

            const statuses = responses.map((response) => response.status);
            expect(statuses.filter((status) => ![201, 400, 409].includes(status))).toEqual([]);
            const created = await prisma.settlement.findMany({ where: { fromId: bob.id, toId: alice.id } });
            expect(created).toHaveLength(statuses.filter((status) => status === 201).length);
            expect(created.length).toBeGreaterThan(0);
            expect(created.reduce((sum, payment) => sum + payment.amount, 0)).toBeLessThanOrEqual(10_000);
        }
    });
});

describe('one expense, edited twice at once', () => {
    it('one edit lands whole, the other is asked to reload, and the shares always add up to the amount', async () => {
        for (let round = 0; round < 5; round++) {
            const [alice, bob, carol] = [await person('Alice'), await person('Bob'), await person('Carol')];
            const { trip } = await groupOf(alice, [bob, carol]);
            const dinner = await expense(trip.id, alice, 30_000, [alice, bob, carol]);
            auth.mockResolvedValue(sessionOf(alice));

            const edit = (amount: number) => expenseRoute.PUT(
                jsonRequest(`http://localhost/api/transactions/${dinner.id}`, {
                    amount,
                    splitType: 'equal',
                    splitAmong: [alice.id, bob.id, carol.id],
                    expectedUpdatedAt: dinner.updatedAt.toISOString(),
                }, { method: 'PUT' }),
                { params: Promise.resolve({ id: dinner.id }) },
            );
            const statuses = (await Promise.all([edit(60_000), edit(90_000)])).map((response) => response.status);

            expect(statuses.sort()).toEqual([200, 409]);
            const saved = await prisma.transaction.findUniqueOrThrow({ where: { id: dinner.id }, include: { splits: true } });
            expect([60_000, 90_000]).toContain(saved.amount);
            expect(saved.splits.map((split) => split.amount)).toEqual([saved.amount / 3, saved.amount / 3, saved.amount / 3]);
        }
    });
});

describe('joining a group', () => {
    it('a double tap on "join" joins once, tells both taps they are in, and tells the group once', async () => {
        for (let round = 0; round < 5; round++) {
            const [alice, bob] = [await person('Alice'), await person('Bob')];
            const { group } = await groupOf(alice, []);
            auth.mockResolvedValue(sessionOf(bob));

            const tap = () => join.POST(jsonRequest('http://localhost/api/groups/join', { inviteCode: group.inviteCode }));
            const statuses = (await Promise.all([tap(), tap()])).map((response) => response.status);

            expect(statuses.sort()).toEqual([200, 201]);
            expect(await prisma.groupMember.count({ where: { groupId: group.id, userId: bob.id } })).toBe(1);
            expect(await prisma.notification.count({ where: { userId: alice.id } })).toBe(1);
        }
    });
});
