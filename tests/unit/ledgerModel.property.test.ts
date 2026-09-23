import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';

// The ledger and the transition table import the database client; the model
// below never touches it.
vi.mock('@/lib/db', () => ({ prisma: {} }));

const { MAX_EXPENSE_PAISE, resolveSplits } = await import('@/lib/expenseSplits');
const { computeGroupBalances } = await import('@/lib/groupFinance');
const { isLedgerSettled, pendingSettlementsOf, planLedgerTransfers, settlementRoom } = await import('@/lib/ledger');
const { SETTLEMENT_TRANSITIONS } = await import('@/lib/settlementTransitions');
type GroupLedger = import('@/lib/ledger').GroupLedger;
type SettlementAction = import('@/lib/settlementTransitions').SettlementAction;

/**
 * A group's whole life, at random: people join and are removed, expenses are
 * added, edited and deleted, payments are started, approved, sent back and
 * declined. Every step goes through the rules the routes enforce, taken from
 * the same functions (resolveSplits, settlementRoom, the transition table, and
 * D-063's rule for removing a member). After every step:
 *
 * - the group nets to zero, exactly, in whole paise;
 * - every expense's shares add up to its amount, once per person;
 * - the room a new payment has is never negative;
 * - the settle-up plan, paid in full, leaves everyone at zero, in fewer
 *   payments than there are people owing or owed.
 *
 * And at the end, with what is still open closed, the plan can be paid through
 * the app's own rules: every payment in it fits, and once all are approved the
 * group is settled. fast-check shrinks any failure to the shortest history that
 * breaks a rule. The counts at the bottom keep the test honest: a generator
 * whose steps were all refused would pass while testing nothing.
 */

interface Expense { id: string; payerId: string; amount: number; splits: { userId: string; amount: number }[]; deleted: boolean }
interface Payment { id: string; fromId: string; toId: string; amount: number; status: string }
interface Group { owner: string; members: string[]; former: string[]; expenses: Expense[]; payments: Payment[]; nextId: number }

const ACTIONS = Object.keys(SETTLEMENT_TRANSITIONS) as SettlementAction[];

/** What the random histories actually did, across every run. */
const happened = { expense: 0, edit: 0, delete: 0, pay: 0, refused: 0, move: 0, remove: 0, join: 0 };

function ledgerOf(group: Group): GroupLedger {
    const everyone = [...group.members, ...group.former];
    const balances = computeGroupBalances({
        memberIds: everyone,
        transactions: group.expenses.map((expense) => ({ ...expense, deletedAt: expense.deleted ? new Date(0) : null })),
        settlements: group.payments.map((payment) => ({ ...payment, deletedAt: null })),
    });
    const person = (id: string) => ({ id, name: id, image: null });
    return {
        groupId: 'g',
        groupName: 'Goa',
        groupEmoji: '',
        ownerId: group.owner,
        inviteCode: 'invite',
        members: group.members.map(person),
        people: new Map(everyone.map((id) => [id, { ...person(id), isMember: group.members.includes(id) }])),
        trips: [],
        defaultTripId: null,
        transactions: [],
        settlements: group.payments.map((payment) => ({
            ...payment,
            tripId: 't',
            method: null,
            note: null,
            createdAt: new Date(0),
            updatedAt: new Date(0),
            from: person(payment.fromId),
            to: person(payment.toId),
        })),
        balances,
    };
}

/** Shares by weight, the remainder to the last person: always exactly the amount. */
function sharesByWeight(amount: number, people: string[], weights: number[]) {
    const total = people.reduce((sum, _, index) => sum + (weights[index] ?? 1), 0) || 1;
    let given = 0;
    return people.map((userId, index) => {
        const share = index === people.length - 1 ? amount - given : Math.floor((amount * (weights[index] ?? 1)) / total);
        given += share;
        return { userId, amount: share };
    });
}

const pick = <T,>(items: readonly T[], index: number): T | undefined => (items.length === 0 ? undefined : items[index % items.length]);

type Step =
    | { kind: 'expense'; payer: number; amount: number; custom: boolean; sharers: number[]; weights: number[] }
    | { kind: 'edit'; which: number; amount: number; sharers: number[] }
    | { kind: 'delete'; which: number }
    | { kind: 'pay'; from: number; to: number; percent: number }
    | { kind: 'move'; which: number; action: number }
    | { kind: 'remove'; who: number }
    | { kind: 'join' };

const amount = fc.oneof(fc.integer({ min: 1, max: 5_000 }), fc.integer({ min: 1, max: MAX_EXPENSE_PAISE }));
const people = fc.uniqueArray(fc.nat(9), { minLength: 1, maxLength: 6 });

const step: fc.Arbitrary<Step> = fc.oneof(
    { weight: 5, arbitrary: fc.record({ kind: fc.constant('expense' as const), payer: fc.nat(9), amount, custom: fc.boolean(), sharers: people, weights: fc.array(fc.integer({ min: 1, max: 9 }), { minLength: 6, maxLength: 6 }) }) },
    { weight: 2, arbitrary: fc.record({ kind: fc.constant('edit' as const), which: fc.nat(), amount, sharers: people }) },
    { weight: 1, arbitrary: fc.record({ kind: fc.constant('delete' as const), which: fc.nat() }) },
    { weight: 4, arbitrary: fc.record({ kind: fc.constant('pay' as const), from: fc.nat(9), to: fc.nat(9), percent: fc.integer({ min: 1, max: 130 }) }) },
    { weight: 4, arbitrary: fc.record({ kind: fc.constant('move' as const), which: fc.nat(), action: fc.nat(ACTIONS.length - 1) }) },
    { weight: 1, arbitrary: fc.record({ kind: fc.constant('remove' as const), who: fc.nat(9) }) },
    { weight: 1, arbitrary: fc.constant({ kind: 'join' as const }) },
);

function apply(group: Group, s: Step) {
    const id = () => `x${group.nextId++}`;
    const members = group.members;
    const chosen = (indexes: number[]) => [...new Set(indexes.map((index) => members[index % members.length]))];

    switch (s.kind) {
        case 'expense': {
            const payerId = pick(members, s.payer)!;
            const sharers = chosen(s.sharers);
            const resolution = resolveSplits(
                s.custom
                    ? { amount: s.amount, splitType: 'custom', splits: sharesByWeight(s.amount, sharers, s.weights) }
                    : { amount: s.amount, splitType: 'equal', splitAmong: sharers },
                members,
            );
            if (resolution.ok) {
                group.expenses.push({ id: id(), payerId, amount: s.amount, splits: resolution.splits, deleted: false });
                happened.expense += 1;
            }
            return;
        }
        case 'edit': {
            const expense = pick(group.expenses.filter((candidate) => !candidate.deleted), s.which);
            if (!expense) return;
            // PUT recomputes shares by the create rules, among current members.
            const resolution = resolveSplits({ amount: s.amount, splitType: 'equal', splitAmong: chosen(s.sharers) }, members);
            if (resolution.ok) {
                Object.assign(expense, { amount: s.amount, splits: resolution.splits });
                happened.edit += 1;
            }
            return;
        }
        case 'delete': {
            const expense = pick(group.expenses.filter((candidate) => !candidate.deleted), s.which);
            if (expense) {
                expense.deleted = true;
                happened.delete += 1;
            }
            return;
        }
        case 'pay': {
            // Someone who owes pays someone who is owed: anything else is refused
            // before the room is even asked for.
            const ledger = ledgerOf(group);
            const fromId = pick(members.filter((member) => (ledger.balances[member] ?? 0) < 0), s.from);
            const toId = pick(members.filter((member) => (ledger.balances[member] ?? 0) > 0), s.to);
            if (!fromId || !toId) return;
            const room = settlementRoom(ledger, fromId, toId);
            expect(room.room).toBeGreaterThanOrEqual(0);
            // Up to 130% of the room: the part past it must be refused.
            const asked = Math.floor((room.room * s.percent) / 100);
            // POST /api/settlements: refused when it doesn't fit.
            if (asked >= 1 && asked <= room.room) {
                group.payments.push({ id: id(), fromId, toId, amount: asked, status: 'pending' });
                happened.pay += 1;
            } else if (asked > room.room) {
                happened.refused += 1;
            }
            return;
        }
        case 'move': {
            const payment = pick(group.payments, s.which);
            if (!payment) return;
            const rule = SETTLEMENT_TRANSITIONS[ACTIONS[s.action]];
            const actorIsMember = members.includes(rule.by === 'payer' ? payment.fromId : payment.toId);
            if (!actorIsMember || !(rule.from as readonly string[]).includes(payment.status)) return;
            if ('checksBalance' in rule && rule.checksBalance && payment.amount > settlementRoom(ledgerOf(group), payment.fromId, payment.toId, payment.id).room) return;
            payment.status = rule.to;
            happened.move += 1;
            return;
        }
        case 'remove': {
            const who = pick(members, s.who)!;
            if (who === group.owner) return;
            const ledger = ledgerOf(group);
            // D-063: only someone square, with nothing open, can be removed.
            if ((ledger.balances[who] ?? 0) !== 0 || pendingSettlementsOf(ledger, who).length > 0) return;
            group.members = members.filter((member) => member !== who);
            group.former.push(who);
            happened.remove += 1;
            return;
        }
        case 'join': {
            if (group.members.length < 8) {
                group.members.push(`p${group.nextId++}`);
                happened.join += 1;
            }
            return;
        }
    }
}

function checkInvariants(group: Group) {
    const ledger = ledgerOf(group);
    const balances = Object.values(ledger.balances);

    expect(balances.every(Number.isSafeInteger)).toBe(true);
    expect(balances.reduce((sum, balance) => sum + balance, 0)).toBe(0);

    for (const expense of group.expenses.filter((candidate) => !candidate.deleted)) {
        expect(expense.splits.reduce((sum, split) => sum + split.amount, 0)).toBe(expense.amount);
        expect(expense.splits.every((split) => split.amount >= 0)).toBe(true);
        expect(new Set(expense.splits.map((split) => split.userId)).size).toBe(expense.splits.length);
    }

    const plan = planLedgerTransfers(ledger);
    const after = { ...ledger.balances };
    for (const transfer of plan) {
        expect(Number.isSafeInteger(transfer.amount) && transfer.amount > 0).toBe(true);
        after[transfer.from] += transfer.amount;
        after[transfer.to] -= transfer.amount;
    }
    expect(Object.values(after).every((balance) => balance === 0)).toBe(true);
    expect(plan.length).toBeLessThanOrEqual(Math.max(0, balances.filter((balance) => balance !== 0).length - 1));
}

describe('a group’s whole life, at random (property test)', () => {
    it('nets to zero after every step, and its settle-up plan can always be paid in full', () => {
        fc.assert(
            fc.property(fc.array(step, { minLength: 20, maxLength: 80 }), (steps) => {
                const group: Group = { owner: 'p0', members: ['p0', 'p1', 'p2'], former: [], expenses: [], payments: [], nextId: 3 };
                for (const s of steps) {
                    apply(group, s);
                    checkInvariants(group);
                }

                // Close what is open, then pay the plan through the same rules.
                for (const payment of group.payments) if (['pending', 'initiated', 'paid_pending'].includes(payment.status)) payment.status = 'cancelled';
                for (const transfer of planLedgerTransfers(ledgerOf(group))) {
                    expect(transfer.amount).toBeLessThanOrEqual(settlementRoom(ledgerOf(group), transfer.from, transfer.to).room);
                    group.payments.push({ id: `plan-${group.nextId++}`, fromId: transfer.from, toId: transfer.to, amount: transfer.amount, status: 'completed' });
                }
                expect(isLedgerSettled(ledgerOf(group))).toBe(true);
            }),
            { numRuns: 300 },
        );

        // Every kind of step really happened, many times over (typical counts
        // are about twice these: 2,800 expenses, 950 edits, 500 deletes, 1,350
        // payments and 400 refused, 700 moves, 70 removals, 550 joins).
        expect(happened.expense).toBeGreaterThan(1_400);
        expect(happened.edit).toBeGreaterThan(450);
        expect(happened.delete).toBeGreaterThan(250);
        expect(happened.pay).toBeGreaterThan(650);
        expect(happened.refused).toBeGreaterThan(200);
        expect(happened.move).toBeGreaterThan(330);
        expect(happened.remove).toBeGreaterThan(30);
        expect(happened.join).toBeGreaterThan(275);
    // About 2 s alone, but it shares the CPU with every other test file: on a
    // busy laptop it once passed 5 s, the default, and was cut off (a 3,000-run
    // soak of the same property found nothing).
    }, 30_000);
});
