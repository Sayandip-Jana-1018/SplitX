import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
    buildBalanceHistory,
    computeGroupBalances,
    simplifyGroupBalances,
    summarizeUserRoute,
    type FinanceMember,
    type FinanceTransactionSnapshot,
} from '@/lib/groupFinance';
import { equalShares } from '@/lib/splits';
import { FIXED_NOW, randomGroupHistory } from '../helpers/financeFixtures';

const member = (id: string, extra: Partial<FinanceMember> = {}): FinanceMember => ({ id, name: `Name ${id}`, image: null, upiId: null, ...extra });

describe('simplifyGroupBalances', () => {
    it('uses the planner: the fewest payments, with names, photos and UPI IDs', () => {
        const members = ['a', 'b', 'c', 'd', 'e'].map((id) => member(id, { image: `/img/${id}.png`, upiId: `${id}@upi` }));
        const transfers = simplifyGroupBalances({ members, balances: { a: -700, b: -300, c: 500, d: 300, e: 200 } });

        expect(transfers).toHaveLength(3);
        expect(transfers).toContainEqual({
            from: 'b', to: 'd', amount: 300,
            fromName: 'Name b', toName: 'Name d', fromImage: '/img/b.png', toImage: '/img/d.png', toUpiId: 'd@upi',
        });
    });

    it('treats a balance of ±1 paisa as settled and ignores balances of non-members', () => {
        const transfers = simplifyGroupBalances({
            members: [member('a'), member('b'), member('c')],
            balances: { a: 1, b: -501, c: 500, outsider: 9_999 },
        });
        expect(transfers).toEqual([expect.objectContaining({ from: 'b', to: 'c', amount: 500 })]);
    });

    it('clears every real group balance to within a paisa', () => {
        for (let seed = 1; seed <= 200; seed++) {
            const { members, transactions, settlements } = randomGroupHistory(seed);
            const balances = computeGroupBalances({ memberIds: members.map((m) => m.id), transactions, settlements });
            const left = { ...balances };
            for (const t of simplifyGroupBalances({ balances, members })) {
                left[t.from] += t.amount;
                left[t.to] -= t.amount;
            }
            for (const amount of Object.values(left)) expect(Math.abs(amount)).toBeLessThanOrEqual(1);
        }
    });
});

describe('buildBalanceHistory', () => {
    beforeAll(() => {
        vi.useFakeTimers();
        vi.setSystemTime(FIXED_NOW);
    });
    afterAll(() => vi.useRealTimers());

    const members = [member('a'), member('b'), member('c')];
    const expense = (id: string, payerId: string, minutesAgo: number): FinanceTransactionSnapshot => {
        const createdAt = new Date(FIXED_NOW.getTime() - minutesAgo * 60_000);
        const shares = equalShares(300, members.length);
        return {
            id, tripId: 't', tripTitle: 'Trip', title: `Expense ${id}`, amount: 300, splitType: 'equal',
            payerId, payerName: `Name ${payerId}`, createdAt, updatedAt: createdAt, deletedAt: null,
            splits: members.map((m, i) => ({ userId: m.id, userName: m.name, amount: shares[i] })),
        };
    };
    const history = (limit: number, cursor = {}) => buildBalanceHistory({
        userId: 'b',
        members,
        transactions: [expense('x1', 'a', 30), expense('x2', 'b', 10)],
        settlements: [],
        auditLogs: [],
        limit,
        ...cursor,
    });

    it('describes the settle-up route before and after each change, page by page', () => {
        const firstPage = history(1);
        expect(firstPage.entries).toHaveLength(1);
        expect(firstPage.entries[0]).toMatchObject({
            sourceId: 'x2',
            beforeBalance: -100,
            afterBalance: 100,
            beforeRouteSummary: 'Pay Name a ₹1',
            afterRouteSummary: 'Receive ₹1 from Name c',
        });
        expect(firstPage.hasMore).toBe(true);

        const secondPage = history(1, firstPage.nextCursor!);
        expect(secondPage.entries).toHaveLength(1);
        expect(secondPage.entries[0]).toMatchObject({
            sourceId: 'x1',
            beforeBalance: 0,
            afterBalance: -100,
            beforeRouteSummary: 'All settled up',
            afterRouteSummary: 'Pay Name a ₹1',
        });
        expect(secondPage.entries[0].explanation).toContain('Route changed from "All settled up" to "Pay Name a ₹1".');
        expect(secondPage.hasMore).toBe(false);
    });

    it('gives the same entries whether fetched in pages or all at once', () => {
        for (let seed = 1; seed <= 100; seed++) {
            const { random, members: people, transactions, settlements, auditLogs } = randomGroupHistory(seed);
            const params = { userId: random.pick(people).id, members: people, transactions, settlements, auditLogs };
            const all = buildBalanceHistory({ ...params, limit: 1_000 });

            const paged = [];
            let cursor: { beforeCreatedAt: string; beforeId: string } | null = null;
            do {
                const page = buildBalanceHistory({ ...params, limit: 3, ...(cursor ?? {}) });
                paged.push(...page.entries);
                cursor = page.nextCursor;
            } while (cursor);

            expect(paged).toEqual(all.entries);
            const current = computeGroupBalances({ memberIds: people.map((m) => m.id), transactions: transactions.filter((t) => !t.deletedAt), settlements });
            expect(all.currentRouteSummary).toBe(summarizeUserRoute(simplifyGroupBalances({ balances: current, members: people }), params.userId));
        }
    });
});
