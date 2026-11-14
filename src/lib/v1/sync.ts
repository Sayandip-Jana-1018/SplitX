import { createHash } from 'node:crypto';
import { prisma } from '@/lib/db';
import type { SyncAnswer, SyncGroup } from '@/lib/contract/v1';
import { loadGroupLedgers, type GroupLedger } from '@/lib/ledger';
import { groupIdsOf } from '@/lib/v1/reads';

/**
 * The phone app's sync (docs/mobile/ROADMAP.md, Phase 2 step 5). The phone keeps
 * each of your groups whole, with the version it got. Each sync it sends those
 * versions; the server loads your groups from the website's own ledger
 * (src/lib/ledger.ts) and sends back, in full, only the groups whose contents
 * differ. A version is a hash of everything sent, so an edit, a deletion, a new
 * member or a renamed person all change it, with no clock to trust and no
 * cursor that could skip a row.
 */

type Unversioned = Omit<SyncGroup, 'version'>;

function contentsOf(ledger: GroupLedger, details: Map<string, { category: string; receiptUrl: string | null }>): Unversioned {
    return {
        id: ledger.groupId,
        name: ledger.groupName,
        emoji: ledger.groupEmoji,
        ownerId: ledger.ownerId,
        people: [...ledger.people.values()].map((person) => ({
            id: person.id,
            name: person.name,
            image: person.image,
            upiId: person.upiId ?? null,
            isMember: person.isMember,
        })),
        expenses: ledger.transactions.map((transaction) => ({
            id: transaction.id,
            title: transaction.title,
            category: details.get(transaction.id)?.category ?? 'general',
            amount: transaction.amount,
            payerId: transaction.payerId,
            splitType: transaction.splitType,
            // Sorted, so the same expense always hashes the same.
            splits: transaction.splits.map((split) => ({ userId: split.userId, amount: split.amount })).sort((a, b) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0)),
            receiptUrl: details.get(transaction.id)?.receiptUrl ?? null,
            createdAt: transaction.createdAt.toISOString(),
        })),
        settlements: ledger.settlements.map((settlement) => ({
            id: settlement.id,
            fromId: settlement.fromId,
            toId: settlement.toId,
            amount: settlement.amount,
            status: settlement.status,
            method: settlement.method,
            note: settlement.note,
            createdAt: settlement.createdAt.toISOString(),
        })),
    };
}

function versionOf(contents: Unversioned): string {
    return createHash('sha256').update(JSON.stringify(contents)).digest('base64url').slice(0, 22);
}

/** Every group you're in now, and in full the ones the phone hasn't got as they are. */
export async function syncLedgers(userId: string, known: Record<string, string>): Promise<SyncAnswer> {
    const ledgers = await loadGroupLedgers(await groupIdsOf(userId));
    // Categories and receipts aren't in the ledger's snapshot: one query for them all.
    const expenseIds = ledgers.flatMap((ledger) => ledger.transactions.map((transaction) => transaction.id));
    const rows = expenseIds.length === 0 ? [] : await prisma.transaction.findMany({ where: { id: { in: expenseIds } }, select: { id: true, category: true, receiptUrl: true } });
    const details = new Map(rows.map((row) => [row.id, { category: row.category, receiptUrl: row.receiptUrl }]));

    const changed: SyncGroup[] = [];
    for (const ledger of ledgers) {
        const contents = contentsOf(ledger, details);
        const version = versionOf(contents);
        if (known[ledger.groupId] !== version) changed.push({ ...contents, version });
    }
    return { groupIds: ledgers.map((ledger) => ledger.groupId), changed };
}
