import { prisma } from '@/lib/db';
import type { ActivityItem, ActivityPage, ActivityQuery, GroupDetail, GroupSummary } from '@/lib/contract/v1';
import { balanceOf, loadGroupLedgers, planLedgerTransfers, type GroupLedger } from '@/lib/ledger';
import { isCompletedSettlementStatus } from '@/lib/settlementStatus';

/**
 * What the phone app reads (docs/mobile/ROADMAP.md, Phase 2 step 2). Every
 * balance comes from the same ledger the website shows (src/lib/ledger.ts), so
 * the two can never disagree about who owes whom.
 */

/** The live groups someone owns or belongs to. */
export async function groupIdsOf(userId: string): Promise<string[]> {
    const groups = await prisma.group.findMany({
        where: { deletedAt: null, OR: [{ ownerId: userId }, { members: { some: { userId } } }] },
        select: { id: true },
    });
    return groups.map((group) => group.id);
}

function lastActivity(ledger: GroupLedger): Date | null {
    let latest: Date | null = null;
    for (const item of [...ledger.transactions, ...ledger.settlements]) if (!latest || item.createdAt > latest) latest = item.createdAt;
    return latest;
}

function summaryOf(ledger: GroupLedger, userId: string): GroupSummary {
    const last = lastActivity(ledger);
    return {
        id: ledger.groupId,
        name: ledger.groupName,
        emoji: ledger.groupEmoji,
        members: ledger.members.map((member) => ({ id: member.id, name: member.name, image: member.image })),
        myBalance: balanceOf(ledger, userId),
        totalSpent: ledger.transactions.reduce((sum, transaction) => sum + transaction.amount, 0),
        lastActivityAt: last ? last.toISOString() : null,
    };
}

/** Your groups, the most recently busy first. */
export async function listGroups(userId: string): Promise<GroupSummary[]> {
    const ledgers = await loadGroupLedgers(await groupIdsOf(userId));
    return ledgers.map((ledger) => summaryOf(ledger, userId)).sort((a, b) => (b.lastActivityAt ?? '').localeCompare(a.lastActivityAt ?? ''));
}

/** One group, or null if it doesn't exist or you aren't in it (the two look the same from outside). */
export async function groupDetail(userId: string, groupId: string): Promise<GroupDetail | null> {
    if (!(await groupIdsOf(userId)).includes(groupId)) return null;
    const [ledger] = await loadGroupLedgers([groupId]);
    if (!ledger) return null;
    return {
        group: summaryOf(ledger, userId),
        people: [...ledger.people.values()].map((person) => ({
            id: person.id,
            name: person.name,
            image: person.image,
            upiId: person.upiId ?? null,
            balance: balanceOf(ledger, person.id),
            isMember: person.isMember,
        })),
        transfers: planLedgerTransfers(ledger).map((transfer) => ({ fromId: transfer.from, toId: transfer.to, amount: transfer.amount, toUpiId: transfer.toUpiId })),
    };
}

/**
 * Expenses and settlements from your groups (or one of them), newest first,
 * with what each did to your balance. Null when asked for a group you aren't in.
 */
export async function activityFeed(userId: string, query: ActivityQuery): Promise<ActivityPage | null> {
    const mine = await groupIdsOf(userId);
    if (query.groupId && !mine.includes(query.groupId)) return null;
    const ledgers = await loadGroupLedgers(query.groupId ? [query.groupId] : mine);
    // The cursor is the last item's time and id: items sharing a time are never skipped.
    const [beforeAt, beforeId = ''] = (query.before ?? '').split('~');
    const before = beforeAt ? new Date(beforeAt) : null;
    if (before && Number.isNaN(before.getTime())) return { items: [], nextBefore: null };
    const older = ({ sortAt, item }: { sortAt: Date; item: ActivityItem }) =>
        !before || sortAt < before || (sortAt.getTime() === before.getTime() && item.id < beforeId);

    const items: { sortAt: Date; item: ActivityItem }[] = [];
    for (const ledger of ledgers) {
        const nameOf = (id: string) => ledger.people.get(id)?.name ?? 'Former member';
        for (const transaction of ledger.transactions) {
            const share = transaction.splits.find((split) => split.userId === userId)?.amount ?? 0;
            const paid = transaction.payerId === userId ? transaction.amount : 0;
            items.push({ sortAt: transaction.createdAt, item: {
                id: transaction.id,
                kind: 'expense',
                groupId: ledger.groupId,
                title: transaction.title,
                category: 'general',
                amount: transaction.amount,
                actorId: transaction.payerId,
                actorName: transaction.payerName,
                otherId: null,
                otherName: null,
                yours: paid - share,
                status: null,
                at: transaction.createdAt.toISOString(),
            } });
        }
        for (const settlement of ledger.settlements) {
            const counts = isCompletedSettlementStatus(settlement.status);
            const yours = !counts ? 0 : settlement.fromId === userId ? settlement.amount : settlement.toId === userId ? -settlement.amount : 0;
            items.push({ sortAt: settlement.createdAt, item: {
                id: settlement.id,
                kind: 'settlement',
                groupId: ledger.groupId,
                title: '',
                category: 'settlement',
                amount: settlement.amount,
                actorId: settlement.fromId,
                actorName: nameOf(settlement.fromId),
                otherId: settlement.toId,
                otherName: nameOf(settlement.toId),
                yours,
                status: settlement.status,
                at: settlement.createdAt.toISOString(),
            } });
        }
    }

    const page = items
        .filter(older)
        .sort((a, b) => b.sortAt.getTime() - a.sortAt.getTime() || (a.item.id < b.item.id ? 1 : a.item.id > b.item.id ? -1 : 0))
        .slice(0, query.limit)
        .map(({ item }) => item);

    // Categories aren't in the ledger's snapshot: one query for this page's expenses.
    const expenseIds = page.filter((item) => item.kind === 'expense').map((item) => item.id);
    if (expenseIds.length > 0) {
        const rows = await prisma.transaction.findMany({ where: { id: { in: expenseIds } }, select: { id: true, category: true } });
        const categories = new Map(rows.map((row) => [row.id, row.category]));
        for (const item of page) if (item.kind === 'expense') item.category = categories.get(item.id) ?? 'general';
    }

    const full = page.length === query.limit;
    return {
        items: page,
        nextBefore: full ? `${page[page.length - 1].at}~${page[page.length - 1].id}` : null,
    };
}
