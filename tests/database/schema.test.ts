import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { MAX_EXPENSE_PAISE } from '@/lib/expenseSplits';
import { emptyDatabase, expense, groupOf, person } from './fixtures';

// What the database itself guarantees, on the Postgres version production runs.
// The code relies on each of these; a migration that loosened one would fail here.

const INT4_MAX = 2_147_483_647;

/** The Prisma error code a write fails with, or 'ok'. */
const outcome = (write: Promise<unknown>) => write.then(
    () => 'ok',
    (error: unknown) => (error instanceof Prisma.PrismaClientKnownRequestError ? error.code : String(error)),
);

beforeEach(emptyDatabase);
afterAll(() => prisma.$disconnect());

describe('relations', () => {
    it('refuses a share, a payment or a membership that points at nothing', async () => {
        const alice = await person('Alice');
        const { group, trip } = await groupOf(alice, []);

        expect(await outcome(prisma.splitItem.create({ data: { transactionId: 'cmissing000000001', userId: alice.id, amount: 100 } }))).toBe('P2003');
        expect(await outcome(prisma.settlement.create({ data: { tripId: trip.id, fromId: alice.id, toId: 'cmissing000000001', amount: 100 } }))).toBe('P2003');
        expect(await outcome(prisma.groupMember.create({ data: { groupId: group.id, userId: 'cmissing000000001' } }))).toBe('P2003');
    });

    it('holds one membership per person per group, and one share per person per expense', async () => {
        const [alice, bob] = [await person('Alice'), await person('Bob')];
        const { group, trip } = await groupOf(alice, [bob]);
        const dinner = await expense(trip.id, alice, 20_000, [alice, bob]);

        expect(await outcome(prisma.groupMember.create({ data: { groupId: group.id, userId: bob.id } }))).toBe('P2002');
        expect(await outcome(prisma.splitItem.create({ data: { transactionId: dinner.id, userId: bob.id, amount: 1 } }))).toBe('P2002');
    });

    it('never deletes someone the money history names: an account can only be anonymised', async () => {
        const [alice, bob] = [await person('Alice'), await person('Bob')];
        const { trip } = await groupOf(alice, [bob]);
        await expense(trip.id, alice, 20_000, [alice, bob]);

        expect(await outcome(prisma.user.delete({ where: { id: bob.id } }))).toBe('P2003');
        expect(await prisma.user.count({ where: { id: bob.id } })).toBe(1);
    });
});

describe('amounts', () => {
    it('stores money in a 32-bit integer: the largest expense fits, and one past the column is refused unwritten', async () => {
        expect(MAX_EXPENSE_PAISE).toBeLessThanOrEqual(INT4_MAX);
        const alice = await person('Alice');
        const { trip } = await groupOf(alice, []);

        const largest = await expense(trip.id, alice, INT4_MAX, [alice]);
        expect((await prisma.transaction.findUniqueOrThrow({ where: { id: largest.id } })).amount).toBe(INT4_MAX);

        await expect(prisma.transaction.create({
            data: { tripId: trip.id, payerId: alice.id, amount: INT4_MAX + 1, title: 'Too much' },
        })).rejects.toThrow();
        expect(await prisma.transaction.count()).toBe(1);
    });

    it('adds up totals past 2^31 exactly, as the AI chat sums spending per category', async () => {
        const alice = await person('Alice');
        const { trip } = await groupOf(alice, []);
        await prisma.transaction.createMany({
            data: Array.from({ length: 25 }, () => ({ tripId: trip.id, payerId: alice.id, amount: MAX_EXPENSE_PAISE, title: 'Villa', category: 'stay' })),
        });

        // The query src/app/api/ai/chat/route.ts runs.
        const [stay] = await prisma.transaction.groupBy({
            by: ['category'],
            where: { tripId: trip.id, deletedAt: null },
            _sum: { amount: true },
        });
        expect(stay._sum.amount).toBe(25 * MAX_EXPENSE_PAISE);
        expect(25 * MAX_EXPENSE_PAISE).toBeGreaterThan(INT4_MAX);
    });
});
