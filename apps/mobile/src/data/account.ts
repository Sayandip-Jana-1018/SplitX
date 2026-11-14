/**
 * A signed-in account's ledger, built from the server's sync (POST /api/v1/sync): the groups exactly
 * as the server sent them, read into the same Ledger the demo uses, so every screen and the
 * website's money engine work on it unchanged. Your own id becomes ME on the way in.
 *
 * Pure TypeScript: the website's database tests check that what the phone works out from a sync
 * matches the website's balances to the paisa (tests/database/v1Sync.test.ts).
 */
import type { SyncAnswer, SyncGroup } from '@/lib/contract/v1';
import { SPLIT_TYPES, type SplitType } from '@/lib/expenseSplits';
import { firstName, ME, type Expense, type Group, type Ledger, type Person, type Settlement } from './ledger';

/** The groups the phone keeps, newest version of each, in the server's order. */
export function mergeSync(kept: SyncGroup[], answer: SyncAnswer): SyncGroup[] {
    const byId = new Map(kept.map((group) => [group.id, group]));
    for (const group of answer.changed) byId.set(group.id, group);
    return answer.groupIds.map((id) => byId.get(id)).filter((group): group is SyncGroup => Boolean(group));
}

/** What the phone tells the server it already has. */
export const versionsOf = (groups: SyncGroup[]) => Object.fromEntries(groups.map((group) => [group.id, group.version]));

const splitType = (value: string): SplitType => ((SPLIT_TYPES as readonly string[]).includes(value) ? (value as SplitType) : 'custom');

/** The most recent thing that happened in a group, for ordering: busiest first, as on the website. */
function lastActivity(group: SyncGroup): string {
    let latest = '';
    for (const item of [...group.expenses, ...group.settlements]) if (item.createdAt > latest) latest = item.createdAt;
    return latest;
}

export function accountLedger(groups: SyncGroup[], meId: string): Ledger {
    const local = (id: string) => (id === meId ? ME : id);
    const people = new Map<string, Person>();
    const ledger: Ledger = { people: [], groups: [], expenses: [], settlements: [], messages: [] };

    for (const group of [...groups].sort((a, b) => lastActivity(b).localeCompare(lastActivity(a)))) {
        for (const person of group.people) {
            const id = local(person.id);
            if (!people.has(id) || person.isMember) people.set(id, { id, name: person.name, first: firstName(person.name), image: person.image, upiId: person.upiId });
        }
        const entry: Group = { id: group.id, name: group.name, emoji: group.emoji, memberIds: group.people.filter((person) => person.isMember).map((person) => local(person.id)) };
        ledger.groups.push(entry);
        for (const expense of group.expenses) {
            const item: Expense = {
                id: expense.id,
                groupId: group.id,
                title: expense.title,
                category: expense.category,
                amount: expense.amount,
                payerId: local(expense.payerId),
                splitType: splitType(expense.splitType),
                splits: expense.splits.map((split) => ({ userId: local(split.userId), amount: split.amount })),
                receipt: expense.receiptUrl,
                createdAt: new Date(expense.createdAt),
            };
            ledger.expenses.push(item);
        }
        for (const settlement of group.settlements) {
            const item: Settlement = {
                id: settlement.id,
                groupId: group.id,
                fromId: local(settlement.fromId),
                toId: local(settlement.toId),
                amount: settlement.amount,
                method: settlement.method ?? 'upi',
                status: settlement.status,
                note: settlement.note,
                createdAt: new Date(settlement.createdAt),
            };
            ledger.settlements.push(item);
        }
    }
    ledger.people = [...people.values()];
    return ledger;
}
