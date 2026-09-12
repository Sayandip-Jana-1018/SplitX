import { describe, expect, it } from 'vitest';
import { calculateEqualSplit, calculateSettlement, optimizeSettlements, type Balance, type Transfer } from '@/lib/settlement';
import { createRandom } from '../helpers/random';

type Txn = Parameters<typeof calculateSettlement>[0][number];

function randomGroup(seed: number) {
    const random = createRandom(seed);
    const members = Array.from({ length: random.int(2, 14) }, (_, i) => ({ id: `u${i}`, name: `User ${i}` }));
    const transactions: Txn[] = Array.from({ length: random.int(1, 40) }, () => {
        const payer = random.pick(members);
        const participants = members.filter(() => random.next() < 0.6);
        const splitAmong = participants.length ? participants : [payer];
        const shares = calculateEqualSplit(random.int(1, 500_000), splitAmong.length);
        return {
            payerId: payer.id,
            payerName: payer.name,
            splits: splitAmong.map((m, i) => ({ userId: m.id, userName: m.name, amount: shares[i] })),
        };
    });
    return { members, transactions };
}

/** Apply transfers to balances; a correct settlement leaves everyone at zero. */
function settle(balances: Balance[], transfers: Transfer[]) {
    const remaining = new Map(balances.map((b) => [b.userId, b.balance]));
    for (const t of transfers) {
        remaining.set(t.fromId, (remaining.get(t.fromId) ?? 0) + t.amount);
        remaining.set(t.toId, (remaining.get(t.toId) ?? 0) - t.amount);
    }
    return remaining;
}

describe('calculateSettlement — invariants over 500 random groups', () => {
    const seeds = Array.from({ length: 500 }, (_, i) => i + 1);

    it.each(seeds)('seed %i: balances sum to zero and transfers clear every balance', (seed) => {
        const { transactions } = randomGroup(seed);
        const result = calculateSettlement(transactions);

        expect(result.balances.reduce((sum, b) => sum + b.balance, 0)).toBe(0);
        for (const [, left] of settle(result.balances, result.transfers)) {
            expect(left).toBe(0);
        }
    });

    it.each(seeds)('seed %i: transfers are positive integers between different people', (seed) => {
        const { transactions } = randomGroup(seed);
        for (const t of calculateSettlement(transactions).transfers) {
            expect(Number.isInteger(t.amount)).toBe(true);
            expect(t.amount).toBeGreaterThan(0);
            expect(t.fromId).not.toBe(t.toId);
        }
    });

    it.each(seeds)('seed %i: nobody both pays and receives, and at most n-1 transfers', (seed) => {
        const { transactions } = randomGroup(seed);
        const { balances, transfers } = calculateSettlement(transactions);
        const payers = new Set(transfers.map((t) => t.fromId));
        const receivers = new Set(transfers.map((t) => t.toId));
        for (const id of payers) expect(receivers.has(id)).toBe(false);

        const unsettled = balances.filter((b) => b.balance !== 0).length;
        expect(transfers.length).toBeLessThanOrEqual(Math.max(0, unsettled - 1));
    });
});

describe('calculateSettlement — known scenarios', () => {
    it('settles a simple trip where one person paid for everyone', () => {
        const result = calculateSettlement([
            {
                payerId: 'a',
                payerName: 'Ankan',
                splits: [
                    { userId: 'a', userName: 'Ankan', amount: 30_000 },
                    { userId: 'b', userName: 'Ankit', amount: 30_000 },
                    { userId: 'c', userName: 'Sayandip', amount: 30_000 },
                ],
            },
        ]);

        expect(result.totalSpent).toBe(90_000);
        expect(result.transfers).toHaveLength(2);
        expect(result.transfers.every((t) => t.toId === 'a' && t.amount === 30_000)).toBe(true);
    });

    it('returns nothing to settle for an empty trip', () => {
        const result = calculateSettlement([]);
        expect(result).toMatchObject({ balances: [], transfers: [], totalSpent: 0, perPersonAvg: 0 });
    });

    it('pairs exact matches directly instead of routing through third parties', () => {
        const balances: Balance[] = [
            { userId: 'a', name: 'A', paid: 0, owes: 0, balance: 5_000 },
            { userId: 'b', name: 'B', paid: 0, owes: 0, balance: -5_000 },
            { userId: 'c', name: 'C', paid: 0, owes: 0, balance: 7_000 },
            { userId: 'd', name: 'D', paid: 0, owes: 0, balance: -7_000 },
        ];
        const transfers = optimizeSettlements(balances);
        expect(transfers).toHaveLength(2);
        expect(transfers).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ fromId: 'b', toId: 'a', amount: 5_000 }),
                expect.objectContaining({ fromId: 'd', toId: 'c', amount: 7_000 }),
            ])
        );
    });

    it('does not mutate the balances it is given', () => {
        const balances: Balance[] = [
            { userId: 'a', name: 'A', paid: 900, owes: 300, balance: 600 },
            { userId: 'b', name: 'B', paid: 0, owes: 600, balance: -600 },
        ];
        const snapshot = structuredClone(balances);
        optimizeSettlements(balances);
        expect(balances).toEqual(snapshot);
    });
});

describe('calculateEqualSplit', () => {
    it.each([
        [100, 3],
        [1, 7],
        [999_999, 13],
        [0, 4],
        [50_000, 1],
    ])('splits %i paise among %i people exactly, differing by at most one paisa', (total, people) => {
        const shares = calculateEqualSplit(total, people);
        expect(shares).toHaveLength(people);
        expect(shares.reduce((a, b) => a + b, 0)).toBe(total);
        expect(Math.max(...shares) - Math.min(...shares)).toBeLessThanOrEqual(1);
    });

    it('returns no shares for zero or negative people', () => {
        expect(calculateEqualSplit(100, 0)).toEqual([]);
        expect(calculateEqualSplit(100, -2)).toEqual([]);
    });
});
