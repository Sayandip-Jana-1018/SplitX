/**
 * Changes to your real groups, saved on the phone first (Phase 2 step 5b). Each change shows at once,
 * marked as sending, and waits here until the server takes it, in the order made:
 *
 * - An expense carries the id the phone made for it (`clientId`), so sending it twice never saves two.
 * - A payment marked as paid asks for the settlement, then marks it paid; asked again, the server
 *   hands back the same open one, so a retry halfway through never makes two.
 * - Offline, too slow, or the server having trouble: the change waits and goes with the next try.
 *   Refused (no longer a member, deleted elsewhere): it is dropped and you're told why.
 *
 * Pure TypeScript, tested by the website's runner (tests/unit/mobileOutbox.test.ts).
 */
import type { ChatMessage, NewExpense, NewMessage, NewSettlement, Settlement as ServerSettlement, SyncGroup } from '@/lib/contract/v1';
import { ApiError, type createApi } from '../api/client';
import { ME, type Expense, type Ledger, type Message, type Settlement } from './ledger';

type Api = ReturnType<typeof createApi>;

export type Change =
    | { kind: 'expense'; id: string; body: NewExpense; local: Expense }
    | { kind: 'delete_expense'; id: string; expenseId: string; groupId: string }
    | { kind: 'payment'; id: string; body: NewSettlement; cash: boolean; local: Settlement }
    | { kind: 'message'; id: string; groupId: string; body: NewMessage; local: Message };

/** What became of sending one change. */
export type Sent =
    | { outcome: 'saved'; patch: (groups: SyncGroup[]) => SyncGroup[]; message?: ChatMessage }
    | { outcome: 'wait' }
    | { outcome: 'refused'; why: string };

/** The ledger as it will be once every waiting change is saved. */
export function withChanges(ledger: Ledger, changes: Change[]): Ledger {
    if (changes.length === 0) return ledger;
    const deleted = new Set(changes.flatMap((change) => (change.kind === 'delete_expense' ? [change.expenseId] : [])));
    return {
        ...ledger,
        expenses: [...ledger.expenses.filter((expense) => !deleted.has(expense.id)), ...changes.flatMap((change) => (change.kind === 'expense' ? [{ ...change.local, pending: true }] : []))],
        settlements: [...ledger.settlements, ...changes.flatMap((change) => (change.kind === 'payment' ? [{ ...change.local, pending: true }] : []))],
        messages: [...ledger.messages, ...changes.flatMap((change) => (change.kind === 'message' ? [{ ...change.local, pending: true }] : []))],
    };
}

/** Deleting something that hasn't been sent yet just forgets it. */
export function deleting(changes: Change[], expenseId: string, groupId: string): Change[] {
    if (changes.some((change) => change.kind === 'expense' && change.id === expenseId)) return changes.filter((change) => change.id !== expenseId);
    return [...changes, { kind: 'delete_expense', id: `delete-${expenseId}`, expenseId, groupId }];
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
                const moved = settlement.status === 'paid_pending' || settlement.status === 'completed' ? { settlement } : await api.moveSettlement(settlement.id, { action: 'mark_paid', cash: change.cash });
                const item = toSyncSettlement(moved.settlement);
                return { outcome: 'saved', patch: inGroup(change.body.groupId, (group) => ({ ...group, settlements: [item, ...group.settlements.filter((s) => s.id !== item.id)] })) };
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
        case 'payment':
            return 'your payment';
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
            if (change.kind === 'expense') return [{ ...change, local: { ...change.local, createdAt: new Date(change.local.createdAt) } }];
            if (change.kind === 'payment') return [{ ...change, local: { ...change.local, createdAt: new Date(change.local.createdAt) } }];
            if (change.kind === 'message') return [{ ...change, local: { ...change.local, at: new Date(change.local.at) } }];
            if (change.kind === 'delete_expense') return [change];
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
