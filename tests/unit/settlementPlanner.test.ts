import { describe, expect, it } from 'vitest';
import { greedyPlan, planSettlement, type AccountBalance, type PlannedTransfer } from '@/lib/settlementPlanner';
import { createRandom } from '../helpers/random';

/** Zero-sum balances. Round amounts make zero-sum subsets (and so savings) likely. */
function randomBalances(seed: number, minPeople: number, maxPeople: number): AccountBalance[] {
    const random = createRandom(seed);
    const people = random.int(minPeople, maxPeople);
    const round = random.next() < 0.5;
    const amounts = Array.from({ length: people - 1 }, () =>
        round ? random.int(-8, 8) * 50_000 : random.int(-500_000, 500_000)
    );
    amounts.push(-amounts.reduce((sum, amount) => sum + amount, 0) || 0);
    return amounts.map((amount, i) => ({ id: `p${i}`, amount }));
}

/** Balances left after applying the transfers. */
function afterTransfers(accounts: readonly AccountBalance[], transfers: readonly PlannedTransfer[]) {
    const left = new Map(accounts.map((account) => [account.id, account.amount]));
    for (const { from, to, amount } of transfers) {
        left.set(from, (left.get(from) ?? 0) + amount);
        left.set(to, (left.get(to) ?? 0) - amount);
    }
    return left;
}

/**
 * Independent oracle: exhaustive search for the fewest transfers. Settles the
 * first open account fully against every opposite-signed account in turn.
 */
function fewestTransfers(accounts: readonly AccountBalance[]) {
    const debts = accounts.map((account) => account.amount).filter((amount) => amount !== 0);
    const search = (start: number): number => {
        while (start < debts.length && debts[start] === 0) start++;
        if (start === debts.length) return 0;
        let best = Infinity;
        for (let i = start + 1; i < debts.length; i++) {
            if (debts[i] * debts[start] < 0) {
                debts[i] += debts[start];
                best = Math.min(best, 1 + search(start + 1));
                debts[i] -= debts[start];
            }
        }
        return best;
    };
    return search(0);
}

function expectWellFormed(transfers: readonly PlannedTransfer[]) {
    for (const transfer of transfers) {
        expect(Number.isSafeInteger(transfer.amount)).toBe(true);
        expect(transfer.amount).toBeGreaterThan(0);
        expect(transfer.from).not.toBe(transfer.to);
    }
}

describe('planSettlement — exact for small groups', () => {
    const seeds = Array.from({ length: 400 }, (_, i) => i + 1);

    it.each(seeds)('seed %i: clears every balance with the proven fewest transfers', (seed) => {
        const accounts = randomBalances(seed, 2, 9);
        const plan = planSettlement(accounts);

        expectWellFormed(plan.transfers);
        for (const [, left] of afterTransfers(accounts, plan.transfers)) expect(left).toBe(0);
        expect(plan.transfers).toHaveLength(fewestTransfers(accounts));
        expect(plan.optimal).toBe(true);
        expect(plan.transfers.length).toBeLessThanOrEqual(plan.greedyTransferCount);
    });

    it('finds the plan largest-first misses', () => {
        const accounts = [
            { id: 'asha', amount: -700 },
            { id: 'bala', amount: -300 },
            { id: 'chen', amount: 500 },
            { id: 'dev', amount: 300 },
            { id: 'esha', amount: 200 },
        ];
        const plan = planSettlement(accounts);

        expect(plan.greedyTransferCount).toBe(4);
        expect(plan).toMatchObject({ algorithm: 'exact', optimal: true });
        expect(plan.transfers).toHaveLength(3);
        expect(plan.transfers).toContainEqual({ from: 'bala', to: 'dev', amount: 300 });
    });

    it('keeps the largest-first plan, unchanged, when it is already the fewest', () => {
        for (let seed = 1; seed <= 300; seed++) {
            const accounts = randomBalances(seed, 2, 12);
            const plan = planSettlement(accounts);
            if (plan.transfers.length === plan.greedyTransferCount) {
                expect(plan.algorithm).toBe('greedy');
                expect(plan.transfers).toEqual(greedyPlan(accounts));
            }
        }
    });

    it('returns nothing to do for no one, or everyone settled', () => {
        expect(planSettlement([])).toEqual({ transfers: [], algorithm: 'greedy', optimal: true, greedyTransferCount: 0 });
        expect(planSettlement([{ id: 'a', amount: 0 }, { id: 'b', amount: 0 }]).transfers).toEqual([]);
    });

    it('is deterministic and leaves its input untouched', () => {
        const accounts = randomBalances(99, 12, 12);
        const snapshot = structuredClone(accounts);
        expect(planSettlement(accounts)).toEqual(planSettlement(accounts));
        expect(accounts).toEqual(snapshot);
    });

    it('rejects amounts that are not whole paise', () => {
        expect(() => planSettlement([{ id: 'a', amount: 10.5 }, { id: 'b', amount: -10.5 }])).toThrow(RangeError);
        expect(() => planSettlement([{ id: 'a', amount: Number.NaN }])).toThrow(RangeError);
    });
});

describe('planSettlement — large groups', () => {
    it.each(Array.from({ length: 40 }, (_, i) => i + 1))('seed %i: clears every balance, never with more transfers than largest-first', (seed) => {
        const accounts = randomBalances(10_000 + seed, 30, 400);
        const plan = planSettlement(accounts, { exactLimit: 4 });

        expectWellFormed(plan.transfers);
        for (const [, left] of afterTransfers(accounts, plan.transfers)) expect(left).toBe(0);
        expect(plan.transfers.length).toBeLessThanOrEqual(plan.greedyTransferCount);
        expect(plan.optimal).toBe(false);
    });

    it('saves transfers on a big event with many repeated shares', () => {
        const random = createRandom(7);
        const amounts = Array.from({ length: 999 }, () => random.int(-20, 20) * 10_000);
        amounts.push(-amounts.reduce((sum, amount) => sum + amount, 0) || 0);
        const plan = planSettlement(amounts.map((amount, i) => ({ id: `p${i}`, amount })));

        expect(plan.algorithm).toBe('heuristic');
        expect(plan.transfers.length).toBeLessThan(plan.greedyTransferCount * 0.8);
    });

    it('pays exact opposites directly even beyond the exact limit', () => {
        // Odd amounts only, so no two people can add up to a third: pairing is the only saving.
        const accounts: AccountBalance[] = [];
        for (let i = 1; i <= 60; i++) {
            const amount = 1_000 + 2 * i + 1;
            accounts.push({ id: `c${i}`, amount }, { id: `d${i}`, amount: -amount });
        }
        accounts.push({ id: 'big', amount: 3 * 501 }, ...[1, 2, 3].map((i) => ({ id: `small${i}`, amount: -501 })));

        const plan = planSettlement(accounts, { exactLimit: 0 });
        expect(plan.algorithm).toBe('heuristic');
        expect(plan.transfers).toHaveLength(60 + 3);
        expect(plan.transfers).toContainEqual({ from: 'd7', to: 'c7', amount: 1_015 });
    });

    it('settles people who add up exactly to a third person with two payments', () => {
        // Primes p: p + 2p = 3p, and no amount equals another's opposite, so no pairs exist.
        const primes = Array.from({ length: 700 }, (_, n) => n).filter((n) => n > 3 && Array.from({ length: n - 2 }, (_, k) => k + 2).every((k) => n % k !== 0)).slice(0, 100);
        const accounts = primes.flatMap((p) => [
            { id: `c${p}`, amount: 3 * p },
            { id: `a${p}`, amount: -p },
            { id: `b${p}`, amount: -2 * p },
        ]);

        const plan = planSettlement(accounts, { exactLimit: 0 });
        expect(plan.algorithm).toBe('heuristic');
        expect(plan.transfers.length).toBeLessThanOrEqual(200);
        for (const [, left] of afterTransfers(accounts, plan.transfers)) expect(left).toBe(0);
    });

    it('still returns a complete plan when the search budget runs out', () => {
        const accounts = randomBalances(5, 500, 500);
        const plan = planSettlement(accounts, { tripleBudget: 0 });
        for (const [, left] of afterTransfers(accounts, plan.transfers)) expect(left).toBe(0);
    });
});

describe('planSettlement — tolerance for group balances', () => {
    it('treats ±tolerance as settled and never moves more than anyone owes or is owed', () => {
        for (let seed = 1; seed <= 300; seed++) {
            const random = createRandom(seed);
            // Balances with the few-paise rounding residue old expenses can leave.
            const accounts = randomBalances(seed, 2, 10).map((account) => ({ ...account, amount: account.amount + random.int(-1, 1) }));
            const plan = planSettlement(accounts, { tolerance: 1 });

            expectWellFormed(plan.transfers);
            const byId = new Map(accounts.map((account) => [account.id, account.amount]));
            for (const [id, left] of afterTransfers(accounts, plan.transfers)) {
                const start = byId.get(id)!;
                if (Math.abs(start) <= 1) expect(left).toBe(start);
                // Payments only ever move a balance toward zero.
                else expect(Math.abs(left)).toBeLessThanOrEqual(Math.abs(start));
                expect(Math.sign(left) === 0 || Math.sign(left) === Math.sign(start)).toBe(true);
            }
            expect(plan.transfers.length).toBeLessThanOrEqual(plan.greedyTransferCount);
        }
    });
});
