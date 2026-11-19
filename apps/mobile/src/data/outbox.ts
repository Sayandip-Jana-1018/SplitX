/**
 * Changes to your real groups, saved on the phone first (Phase 2 step 5b). Each change shows at once,
 * marked as sending, and waits here until the server takes it, in the order made:
 *
 * - An expense carries the id the phone made for it (`clientId`), so sending it twice never saves two.
 * - A payment marked as paid asks for the settlement, then marks it paid; asked again, the server
 *   hands back the same open one, so a retry halfway through never makes two.
 * - An edit carries the expense's version as last seen, so one made elsewhere in the meantime is
 *   refused rather than overwritten. Edits to one expense waiting together go as one; editing one
 *   not sent yet just changes what will be sent.
 * - Money handed to you in cash is recorded the same way, from your side: the payment, then accepting
 *   the cash. Your answer to a payment someone marked as paid (confirm it, send it back, say it never
 *   came) waits here too, so a trip with no signal can still settle up.
 * - Offline, too slow, or the server having trouble: the change waits and goes with the next try.
 *   Refused (no longer a member, deleted elsewhere): it is dropped and you're told why.
 *
 * Pure TypeScript, tested by the website's runner (tests/unit/mobileOutbox.test.ts).
 */
import type { ChatMessage, ExpenseEdit, NewExpense, NewMessage, NewSettlement, Settlement as ServerSettlement, SyncGroup } from '@/lib/contract/v1';
import { ApiError, type createApi } from '../api/client';
import { ME, type Expense, type Ledger, type Message, type Settlement } from './ledger';

type Api = ReturnType<typeof createApi>;

/** The receiver's answers to a payment, and the state each leaves it in (src/lib/settlementTransitions.ts). */
export const RECEIVER_MOVES = { approve: 'completed', send_back: 'initiated', accept_cash: 'completed', decline: 'cancelled' } as const;
export type ReceiverMove = keyof typeof RECEIVER_MOVES;

export type Change =
    | { kind: 'expense'; id: string; body: NewExpense; local: Expense }
    | { kind: 'delete_expense'; id: string; expenseId: string; groupId: string }
    | { kind: 'edit_expense'; id: string; expenseId: string; groupId: string; body: ExpenseEdit; local: Expense }
    /** You paid (or, `received`, you were paid in cash and say so). */
    | { kind: 'payment'; id: string; body: NewSettlement; cash: boolean; received?: boolean; local: Settlement }
    | { kind: 'move'; id: string; settlementId: string; groupId: string; action: ReceiverMove }
    | { kind: 'message'; id: string; groupId: string; body: NewMessage; local: Message };

/** A change the server refused, kept so you can try it again or let it go. */
export interface Stuck {
    change: Change;
    why: string;
    /** The group's name when it was refused (you may no longer be in it). */
    groupName?: string;
}

/** The group a change belongs to. */
export const groupOf = (change: Change) => (change.kind === 'expense' ? change.body.groupId : change.kind === 'payment' ? change.body.groupId : change.groupId);

/** What became of sending one change. */
export type Sent =
    | { outcome: 'saved'; patch: (groups: SyncGroup[]) => SyncGroup[]; message?: ChatMessage }
    | { outcome: 'wait' }
    | { outcome: 'refused'; why: string };

/** The ledger as it will be once every waiting change is saved. */
export function withChanges(ledger: Ledger, changes: Change[]): Ledger {
    if (changes.length === 0) return ledger;
    const deleted = new Set(changes.flatMap((change) => (change.kind === 'delete_expense' ? [change.expenseId] : [])));
    const edited = new Map(changes.flatMap((change) => (change.kind === 'edit_expense' ? [[change.expenseId, change.local] as const] : [])));
    // The last answer to each payment is the one that counts.
    const answered = new Map(changes.flatMap((change) => (change.kind === 'move' ? [[change.settlementId, RECEIVER_MOVES[change.action]] as const] : [])));
    const settlements = answered.size === 0 ? ledger.settlements : ledger.settlements.map((s) => (answered.has(s.id) ? { ...s, status: answered.get(s.id)!, pending: true } : s));
    return {
        ...ledger,
        expenses: [
            ...ledger.expenses.filter((expense) => !deleted.has(expense.id)).map((expense) => (edited.has(expense.id) ? { ...edited.get(expense.id)!, pending: true } : expense)),
            ...changes.flatMap((change) => (change.kind === 'expense' ? [{ ...change.local, pending: true }] : [])),
        ],
        settlements: [...settlements, ...changes.flatMap((change) => (change.kind === 'payment' ? [{ ...change.local, pending: true }] : []))],
        messages: [...ledger.messages, ...changes.flatMap((change) => (change.kind === 'message' ? [{ ...change.local, pending: true }] : []))],
    };
}

type ServerId = (id: string) => string;

/** What an expense says about itself and how it splits, as the server takes it: your id where the phone says ME. */
export function sharesBody(expense: Expense, among: string[], serverId: ServerId) {
    return {
        title: expense.title,
        amount: expense.amount,
        category: expense.category,
        splitType: expense.splitType,
        ...(expense.splitType === 'equal'
            ? { splitAmong: among.map(serverId) }
            : { splits: expense.splits.map((split) => ({ userId: serverId(split.userId), amount: split.amount })) }),
    };
}

const sameShares = (a: Expense['splits'], b: Expense['splits']) => {
    const key = (shares: Expense['splits']) => shares.map((share) => `${share.userId}:${share.amount}`).sort().join(',');
    return key(a) === key(b);
};

/**
 * An edit as the server takes it: only what changed, with the split whole when it changed at
 * all, and the version the phone saw. Null when nothing changed.
 */
export function editBody(before: Expense, after: Expense, among: string[], serverId: ServerId): ExpenseEdit | null {
    const body: ExpenseEdit = {};
    if (after.title !== before.title) body.title = after.title;
    if (after.category !== before.category) body.category = after.category;
    if (after.amount !== before.amount || after.splitType !== before.splitType || !sameShares(after.splits, before.splits)) {
        const shares = sharesBody(after, among, serverId);
        body.amount = shares.amount;
        body.splitType = shares.splitType;
        if ('splitAmong' in shares) body.splitAmong = shares.splitAmong;
        else body.splits = shares.splits;
    }
    if (Object.keys(body).length === 0) return null;
    if (before.updatedAt) body.expectedUpdatedAt = before.updatedAt;
    return body;
}

/** Deleting something that hasn't been sent yet just forgets it; edits waiting for it are dropped too. */
export function deleting(changes: Change[], expenseId: string, groupId: string): Change[] {
    const rest = changes.filter((change) => !(change.kind === 'edit_expense' && change.expenseId === expenseId));
    if (rest.some((change) => change.kind === 'expense' && change.id === expenseId)) return rest.filter((change) => change.id !== expenseId);
    return [...rest, { kind: 'delete_expense', id: `delete-${expenseId}`, expenseId, groupId }];
}

/**
 * An edit joins one already waiting for the same expense: the newer fields win, and the version
 * first seen is kept, since that is what the server has to still hold.
 */
export function editing(changes: Change[], edit: Extract<Change, { kind: 'edit_expense' }>): Change[] {
    const waiting = changes.find((change): change is Extract<Change, { kind: 'edit_expense' }> => change.kind === 'edit_expense' && change.expenseId === edit.expenseId);
    if (!waiting) return [...changes, edit];
    const body = { ...waiting.body, ...edit.body, ...(waiting.body.expectedUpdatedAt ? { expectedUpdatedAt: waiting.body.expectedUpdatedAt } : {}) };
    return changes.map((change) => (change === waiting ? { ...waiting, body, local: edit.local } : change));
}

const toSyncSettlement = (settlement: ServerSettlement) => ({
    id: settlement.id,
    fromId: settlement.fromId,
    toId: settlement.toId,
    amount: settlement.amount,
    status: settlement.status,
    method: settlement.method,
    note: settlement.note,
    createdAt: settlement.createdAt,
});

const inGroup = (groupId: string, change: (group: SyncGroup) => SyncGroup) => (groups: SyncGroup[]) => groups.map((group) => (group.id === groupId ? change(group) : group));

/** Sends one change; what the server answered goes straight into the groups kept, so nothing flickers before the next sync. */
export async function send(api: Api, change: Change): Promise<Sent> {
    try {
        switch (change.kind) {
            case 'expense': {
                const { expense } = await api.saveExpense(change.body);
                const item = { id: expense.id, title: expense.title, category: expense.category, amount: expense.amount, payerId: expense.payerId, splitType: expense.splitType, splits: expense.splits, receiptUrl: null, createdAt: expense.createdAt };
                return { outcome: 'saved', patch: inGroup(change.body.groupId, (group) => ({ ...group, expenses: [...group.expenses.filter((e) => e.id !== item.id), item] })) };
            }
            case 'edit_expense': {
                const { expense } = await api.editExpense(change.expenseId, change.body);
                const item = { title: expense.title, category: expense.category, amount: expense.amount, payerId: expense.payerId, splitType: expense.splitType, splits: expense.splits, updatedAt: expense.updatedAt };
                return { outcome: 'saved', patch: inGroup(change.groupId, (group) => ({ ...group, expenses: group.expenses.map((e) => (e.id === expense.id ? { ...e, ...item } : e)) })) };
            }
            case 'delete_expense': {
                try {
                    await api.deleteExpense(change.expenseId);
                } catch (error) {
                    // Already gone (deleted on the website, or this delete went through before): done either way.
                    if (!(error instanceof ApiError && error.status === 404)) throw error;
                }
                return { outcome: 'saved', patch: inGroup(change.groupId, (group) => ({ ...group, expenses: group.expenses.filter((e) => e.id !== change.expenseId) })) };
            }
            case 'payment': {
                const { settlement } = await api.askSettlement(change.body);
                // Asked again after a retry, the server hands back the same payment: each step is taken once.
                const done = change.received ? settlement.status === 'completed' : settlement.status === 'paid_pending' || settlement.status === 'completed';
                const moved = done ? { settlement } : await api.moveSettlement(settlement.id, change.received ? { action: 'accept_cash' } : { action: 'mark_paid', cash: change.cash });
                const item = toSyncSettlement(moved.settlement);
                return { outcome: 'saved', patch: inGroup(change.body.groupId, (group) => ({ ...group, settlements: [item, ...group.settlements.filter((s) => s.id !== item.id)] })) };
            }
            case 'move': {
                const { settlement } = await api.moveSettlement(change.settlementId, { action: change.action });
                const item = toSyncSettlement(settlement);
                return { outcome: 'saved', patch: inGroup(change.groupId, (group) => ({ ...group, settlements: group.settlements.map((s) => (s.id === item.id ? item : s)) })) };
            }
            case 'message': {
                const { message } = await api.sendMessage(change.groupId, change.body);
                return { outcome: 'saved', patch: (groups) => groups, message };
            }
        }
    } catch (error) {
        if (error instanceof ApiError && (error.kind === 'refused' || error.kind === 'bad_answer')) return { outcome: 'refused', why: error.message };
        // Offline, too slow, server trouble, or signed out (which sign-in handles): try again later.
        return { outcome: 'wait' };
    }
}

/** What to call a change in a message to you. */
export function describe(change: Change): string {
    switch (change.kind) {
        case 'expense':
            return `“${change.local.title}”`;
        case 'delete_expense':
            return 'deleting that expense';
        case 'edit_expense':
            return `your change to “${change.local.title}”`;
        case 'payment':
            return change.received ? 'the cash you were paid' : 'your payment';
        case 'move':
            return change.action === 'approve' ? 'confirming that payment' : change.action === 'accept_cash' ? 'the cash you were paid' : change.action === 'send_back' ? 'sending that payment back' : 'saying that payment never came';
        case 'message':
            return 'your message';
    }
}

/** Saved to the phone as JSON; dates come back as dates, and anything unreadable is dropped. */
export function reviveChanges(text: string | null): Change[] {
    try {
        const raw: unknown = text ? JSON.parse(text) : null;
        if (!Array.isArray(raw)) return [];
        return raw.flatMap((change: Change): Change[] => {
            if (!change || typeof change !== 'object' || typeof change.id !== 'string') return [];
            if (change.kind === 'expense' || change.kind === 'edit_expense') return [{ ...change, local: { ...change.local, createdAt: new Date(change.local.createdAt) } }];
            if (change.kind === 'payment') return [{ ...change, local: { ...change.local, createdAt: new Date(change.local.createdAt) } }];
            if (change.kind === 'message') return [{ ...change, local: { ...change.local, at: new Date(change.local.at) } }];
            if (change.kind === 'delete_expense' || (change.kind === 'move' && change.action in RECEIVER_MOVES)) return [change];
            return [];
        });
    } catch {
        return [];
    }
}

/** A chat message from the server, in the app's terms (your own id is ME). */
export function chatMessage(message: ChatMessage, groupId: string, meId: string): Message | null {
    // Expenses and payments already show in the chat from the ledger; only what people wrote is a message.
    if (message.type !== 'text' && message.type !== 'payment_reminder') return null;
    return { id: message.id, groupId, fromId: message.senderId === meId ? ME : message.senderId, text: message.content, at: new Date(message.createdAt) };
}
