/**
 * The app's ledger, worked out by the website's own money engine (src/lib): splits by
 * resolveSplits, balances by computeGroupBalances, and who pays whom by the settlement planner.
 * The demo starts from made-up people and expenses (below); a signed-in account's ledger is built
 * from the server's sync (account.ts). Either way `ME` means you, and amounts are paise; a
 * positive balance means the group owes that person.
 */
import { resolveSplits, type SplitType } from '@/lib/expenseSplits';
import { computeGroupBalances, simplifyGroupBalances, type FinanceMember, type SimplifiedTransfer } from '@/lib/groupFinance';
import { isCompletedSettlementStatus } from '@/lib/settlementStatus';

export const ME = 'me';

export interface Person extends FinanceMember {
    first: string;
}

/** Made-up people. Their UPI IDs end in @demo, which no bank uses, so none can be a real person's. */
export const PEOPLE: Person[] = [
    { id: ME, name: 'Asha Sharma', first: 'Asha', image: null, upiId: 'asha@demo' },
    { id: 'ravi', name: 'Ravi Menon', first: 'Ravi', image: null, upiId: 'ravi@demo' },
    { id: 'meera', name: 'Meera Iyer', first: 'Meera', image: null, upiId: 'meera@demo' },
    { id: 'kabir', name: 'Kabir Khan', first: 'Kabir', image: null, upiId: 'kabir@demo' },
    { id: 'nisha', name: 'Nisha Rao', first: 'Nisha', image: null, upiId: 'nisha@demo' },
];

/** Someone in the demo. */
export const personById = (id: string): Person => PEOPLE.find((person) => person.id === id) ?? { id, name: 'Former member', first: 'Someone', image: null };

/** Someone this ledger mentions, by id; a name the ledger has lost reads "Former member". */
export const personIn = (ledger: Ledger, id: string): Person => ledger.people.find((person) => person.id === id) ?? { id, name: 'Former member', first: 'Someone', image: null };

/** "Asha" from "Asha Sharma". */
export const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

export interface Group {
    id: string;
    name: string;
    emoji: string;
    memberIds: string[];
}

export interface Expense {
    id: string;
    groupId: string;
    title: string;
    category: string;
    amount: number;
    payerId: string;
    splitType: SplitType;
    splits: { userId: string; amount: number }[];
    /** Split by shares (2 for Ravi, 1 each for the rest): stored as exact amounts, with the shares kept to show. */
    weights?: Record<string, number>;
    /** A photo of the receipt, on this phone only until Phase 3 uploads it. */
    receipt?: string | null;
    createdAt: Date;
    /** Saved on the phone, waiting to reach the server. */
    pending?: boolean;
}

export interface Message {
    id: string;
    groupId: string;
    fromId: string;
    text: string;
    at: Date;
    pending?: boolean;
}

export interface Settlement {
    id: string;
    groupId: string;
    fromId: string;
    toId: string;
    amount: number;
    method: string;
    /** Only completed payments move balances; the others are waiting for someone (as on the website). */
    status: string;
    note?: string | null;
    createdAt: Date;
    pending?: boolean;
}

export interface Ledger {
    /** Everyone the ledger mentions, you (ME) included, and anyone who has left a group. */
    people: Person[];
    groups: Group[];
    expenses: Expense[];
    settlements: Settlement[];
    messages: Message[];
}

const daysAgo = (days: number, hour = 13) => {
    const date = new Date();
    date.setDate(date.getDate() - days);
    date.setHours(hour, 15, 0, 0);
    return date;
};

export interface ExpenseInput extends Omit<Expense, 'splits' | 'splitType'> {
    splitType?: SplitType;
    /** Equal splits: who shares it. Left out, every member does. */
    among?: string[];
    /** Percentage and custom splits: what each person owes, in paise. */
    shares?: { userId: string; amount: number }[];
}

/** An expense, split by the website's rules; an invalid split throws, which a seed should. */
export function makeExpense({ among, shares, splitType = 'equal', ...rest }: ExpenseInput, group: Group): Expense {
    const resolved = resolveSplits({ amount: rest.amount, splitType, splitAmong: among, splits: shares }, group.memberIds);
    if (!resolved.ok) throw new Error(resolved.error);
    return { ...rest, splitType, splits: resolved.splits };
}

const GROUPS: Group[] = [
    { id: 'goa', name: 'Goa Trip', emoji: '🏖️', memberIds: [ME, 'ravi', 'meera', 'kabir'] },
    { id: 'flat', name: 'Flat 402', emoji: '🏠', memberIds: [ME, 'nisha', 'ravi'] },
    { id: 'ladakh', name: 'Ladakh 2026', emoji: '🏔️', memberIds: [ME, 'ravi', 'meera', 'kabir', 'nisha'] },
    { id: 'lunch', name: 'Office Lunch', emoji: '🍱', memberIds: [ME, 'kabir', 'nisha', 'meera'] },
];

const group = (id: string) => GROUPS.find((candidate) => candidate.id === id)!;

export function seedLedger(): Ledger {
    const expenses: Expense[] = [
        makeExpense({ id: 'e1', groupId: 'goa', title: 'Beach shack dinner', category: 'food', amount: 480_000, payerId: ME, createdAt: daysAgo(0, 21) }, group('goa')),
        makeExpense({ id: 'e2', groupId: 'goa', title: 'Scooter rental', category: 'transport', amount: 240_000, payerId: ME, createdAt: daysAgo(1) }, group('goa')),
        makeExpense({ id: 'e3', groupId: 'goa', title: 'Villa, two nights', category: 'stay', amount: 1_840_000, payerId: 'ravi', createdAt: daysAgo(2) }, group('goa')),
        makeExpense({ id: 'e4', groupId: 'goa', title: 'Parasailing', category: 'entertainment', amount: 600_000, payerId: ME, createdAt: daysAgo(2, 16) }, group('goa')),
        makeExpense({ id: 'e5', groupId: 'flat', title: 'Rent, November', category: 'bills', amount: 4_500_000, payerId: ME, createdAt: daysAgo(6) }, group('flat')),
        makeExpense({ id: 'e6', groupId: 'flat', title: 'Electricity bill', category: 'bills', amount: 321_000, payerId: ME, createdAt: daysAgo(3) }, group('flat')),
        makeExpense({ id: 'e7', groupId: 'flat', title: 'Groceries', category: 'groceries', amount: 352_575, payerId: 'nisha', createdAt: daysAgo(1, 19) }, group('flat')),
        makeExpense({ id: 'e8', groupId: 'ladakh', title: 'Bike rentals', category: 'transport', amount: 2_500_000, payerId: 'kabir', createdAt: daysAgo(12) }, group('ladakh')),
        makeExpense({ id: 'e9', groupId: 'ladakh', title: 'Camps at Pangong', category: 'stay', amount: 1_780_000, payerId: ME, createdAt: daysAgo(11) }, group('ladakh')),
        makeExpense({
            id: 'e10',
            groupId: 'lunch',
            title: 'Thali for four',
            category: 'food',
            amount: 106_000,
            payerId: 'kabir',
            splitType: 'custom',
            shares: [
                { userId: ME, amount: 26_500 },
                { userId: 'kabir', amount: 26_500 },
                { userId: 'nisha', amount: 26_500 },
                { userId: 'meera', amount: 26_500 },
            ],
            createdAt: daysAgo(0, 13),
        }, group('lunch')),
    ];
    const settlements: Settlement[] = [
        { id: 's1', groupId: 'goa', fromId: 'kabir', toId: ME, amount: 150_000, method: 'gpay', status: 'completed', createdAt: daysAgo(1, 20) },
    ];
    const message = (id: string, groupId: string, fromId: string, text: string, at: Date): Message => ({ id, groupId, fromId, text, at });
    const messages: Message[] = [
        message('m1', 'goa', 'ravi', 'Villa is booked for both nights 🎉 added it here', daysAgo(2, 11)),
        message('m2', 'goa', 'meera', 'Who has the scooter keys?', daysAgo(1, 10)),
        message('m3', 'goa', ME, 'Me! Parked outside the shack', daysAgo(1, 10)),
        message('m4', 'goa', 'kabir', 'Sent you ₹1,500 for the scooters Asha', daysAgo(1, 20)),
        message('m5', 'goa', 'ravi', 'Dinner tonight was unreal. Asha you got this one?', daysAgo(0, 22)),
        message('m6', 'flat', 'nisha', 'Groceries done, added them. We are out of coffee again ☕', daysAgo(1, 19)),
        message('m7', 'flat', ME, 'Rent for November is in, split three ways', daysAgo(6, 9)),
        message('m8', 'ladakh', 'kabir', 'Bikes paid for. Pangong camp next!', daysAgo(12, 18)),
        message('m9', 'lunch', 'kabir', 'Thali for four, ₹265 each', daysAgo(0, 14)),
    ];
    return { people: PEOPLE, groups: GROUPS, expenses, settlements, messages };
}

/** Each member's balance in one group. */
export function groupBalances(ledger: Ledger, groupId: string): Record<string, number> {
    const target = ledger.groups.find((candidate) => candidate.id === groupId);
    if (!target) return {};
    return computeGroupBalances({
        memberIds: target.memberIds,
        transactions: ledger.expenses.filter((expense) => expense.groupId === groupId).map((expense) => ({ ...expense, deletedAt: null })),
        settlements: ledger.settlements.filter((settlement) => settlement.groupId === groupId).map((settlement) => ({ ...settlement, deletedAt: null })),
    });
}

/** The fewest payments that clear one group. */
export function groupTransfers(ledger: Ledger, groupId: string): SimplifiedTransfer[] {
    return simplifyGroupBalances({ balances: groupBalances(ledger, groupId), people: ledger.people });
}

export interface Totals {
    net: number;
    owedToYou: number;
    youOwe: number;
}

/** Where you stand across every group. */
export function totals(ledger: Ledger): Totals {
    let owedToYou = 0;
    let youOwe = 0;
    for (const target of ledger.groups) {
        const mine = groupBalances(ledger, target.id)[ME] ?? 0;
        if (mine > 0) owedToYou += mine;
        else youOwe -= mine;
    }
    return { net: owedToYou - youOwe, owedToYou, youOwe };
}

export interface ActivityItem {
    id: string;
    kind: 'expense' | 'settlement';
    title: string;
    groupId: string;
    note: string;
    category: string;
    /** What it did to your balance. */
    yours: number;
    at: Date;
}

/** Expenses and payments, newest first, with what each meant for you. */
export function activity(ledger: Ledger, groupId?: string): ActivityItem[] {
    const first = (id: string) => personIn(ledger, id).first;
    const items: ActivityItem[] = [];
    for (const expense of ledger.expenses) {
        if (groupId && expense.groupId !== groupId) continue;
        const share = expense.splits.find((split) => split.userId === ME)?.amount ?? 0;
        const paid = expense.payerId === ME ? expense.amount : 0;
        const payer = expense.payerId === ME ? 'You' : first(expense.payerId);
        items.push({ id: expense.id, kind: 'expense', title: expense.title, groupId: expense.groupId, note: expense.pending ? 'Sending…' : `${payer} paid`, category: expense.category, yours: paid - share, at: expense.createdAt });
    }
    for (const settlement of ledger.settlements) {
        if (groupId && settlement.groupId !== groupId) continue;
        const done = isCompletedSettlementStatus(settlement.status);
        // A payment reads as money: what you received is positive, what you paid negative. One still on its way moves nothing yet.
        const yours = !done ? 0 : settlement.toId === ME ? settlement.amount : settlement.fromId === ME ? -settlement.amount : 0;
        const title = settlement.toId === ME ? `${first(settlement.fromId)} paid you back` : settlement.fromId === ME ? `You paid ${first(settlement.toId)}` : `${first(settlement.fromId)} paid ${first(settlement.toId)}`;
        const note = settlement.pending ? 'Sending…' : done ? (settlement.method === 'cash' ? 'Settled in cash' : 'Settled by UPI') : 'Waiting to be confirmed';
        items.push({ id: settlement.id, kind: 'settlement', title, groupId: settlement.groupId, note, category: 'settlement', yours, at: settlement.createdAt });
    }
    return items.sort((a, b) => b.at.getTime() - a.at.getTime());
}
