import { Prisma } from '@prisma/client';
import { createAuditLog } from '@/lib/auditLog';
import { serializeTransactionAuditSnapshot } from '@/lib/auditPayloads';
import { prisma } from '@/lib/db';
import { resolveSplits, SPLIT_TYPES, type SplitType } from '@/lib/expenseSplits';
import { recordTransactionCreated } from '@/lib/metrics';
import { isOwnReceiptUrl } from '@/lib/receiptUrl';
import { formatCurrency } from '@/lib/utils';
import { pushToPhones } from '@/lib/notifications';

/**
 * Adding, editing and deleting an expense, for every caller: the website
 * (/api/transactions) and the phone app (/api/v1/expenses). The rules live
 * here once, so the two can't drift (docs/mobile/ROADMAP.md, Phase 2 step 3
 * and Phase 4 step 2).
 */

/** What a created expense is answered with, the first time and on any repeat. */
const CREATED_INCLUDE = {
    splits: { include: { user: { select: { id: true, name: true } } } },
    payer: { select: { id: true, name: true } },
    trip: { select: { id: true, title: true } },
} as const;

type CreatedExpense = Prisma.TransactionGetPayload<{ include: typeof CREATED_INCLUDE }>;

// Category labels for notification messages
const CATEGORY_LABELS: Record<string, string> = {
    general: 'General',
    food: 'Food & Drinks',
    transport: 'Transport',
    shopping: 'Shopping',
    tickets: 'Tickets & Entry',
    fuel: 'Fuel',
    medical: 'Medical',
    entertainment: 'Entertainment',
    stay: 'Accommodation',
    other: 'Other',
};

export interface NewExpense {
    tripId: string;
    title: string;
    /** Paise. */
    amount: number;
    category: string;
    method: string;
    description?: string;
    receiptUrl?: string;
    /** Who paid; the person saving it when left out. */
    payerId?: string;
    splitType: SplitType;
    splitAmong?: string[];
    splits?: { userId: string; amount: number }[];
}

export type CreateExpenseOutcome =
    | { ok: true; expense: CreatedExpense; replayed: boolean }
    | { ok: false; status: 400 | 404; error: string; code: 'not_own_receipt' | 'no_trip' | 'bad_payer' | 'bad_split' };

/**
 * Saves an expense as `actor`. `idempotencyKey` is the client's own key for
 * this save, already prefixed with the actor's id: a repeated save (a double
 * tap, or a retry after the answer was lost) gets the expense the first one
 * made, with nothing added.
 */
export async function createExpense(actor: { id: string; name: string | null }, input: NewExpense, idempotencyKey: string | null): Promise<CreateExpenseOutcome> {
    if (idempotencyKey) {
        const earlier = await prisma.transaction.findUnique({ where: { idempotencyKey }, include: CREATED_INCLUDE });
        if (earlier) return { ok: true, expense: earlier, replayed: true };
    }

    // Uploads land in the uploader's own folder: a new expense can't borrow someone else's photo.
    if (input.receiptUrl && !isOwnReceiptUrl(input.receiptUrl, actor.id)) {
        return { ok: false, status: 400, error: 'Attach a receipt photo you uploaded', code: 'not_own_receipt' };
    }

    // Verify trip exists and user has access
    const trip = await prisma.trip.findFirst({
        where: {
            id: input.tripId,
            group: {
                deletedAt: null,
                OR: [
                    { ownerId: actor.id },
                    { members: { some: { userId: actor.id } } },
                ],
            },
        },
        include: {
            group: { include: { members: true } },
        },
    });
    if (!trip) return { ok: false, status: 404, error: 'Trip not found or access denied', code: 'no_trip' };

    const { title, amount, category, method, description, receiptUrl, splitType, splitAmong, splits, payerId: requestedPayerId } = input;

    // The payer must be a member. An unknown payer is refused rather than
    // quietly replaced by the person saving the expense.
    const allMemberIds: string[] = trip.group.members.map((m: { userId: string }) => m.userId);
    if (requestedPayerId && !allMemberIds.includes(requestedPayerId)) {
        return { ok: false, status: 400, error: 'The payer must be a current member of the group', code: 'bad_payer' };
    }
    const actualPayerId = requestedPayerId ?? actor.id;

    // The same rules as editing (lib/expenseSplits.ts): members only, each
    // once, adding up to the amount exactly.
    const resolution = resolveSplits({ amount, splitType, splitAmong, splits }, allMemberIds);
    if (!resolution.ok) return { ok: false, status: 400, error: resolution.error, code: 'bad_split' };
    const splitData = resolution.splits;

    // Create transaction + splits atomically
    let transaction: CreatedExpense;
    try {
        transaction = await prisma.transaction.create({
            data: {
                tripId: input.tripId,
                payerId: actualPayerId,
                title,
                amount,
                category,
                method,
                description,
                receiptUrl: receiptUrl ?? null,
                splitType,
                idempotencyKey,
                splits: {
                    create: splitData.map((s) => ({
                        userId: s.userId,
                        amount: s.amount,
                    })),
                },
            },
            include: CREATED_INCLUDE,
        });
    } catch (error) {
        // Two saves with one key at the same moment: the key's unique
        // index let the other one in first.
        if (idempotencyKey && error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            const earlier = await prisma.transaction.findUnique({ where: { idempotencyKey }, include: CREATED_INCLUDE });
            if (earlier) return { ok: true, expense: earlier, replayed: true };
        }
        throw error;
    }
    // Expenses carrying a receipt come from the scan flow.
    recordTransactionCreated(receiptUrl ? 'receipt' : 'manual', category, transaction.amount);

    await createAuditLog({
        userId: actor.id,
        action: 'create',
        entityType: 'transaction',
        entityId: transaction.id,
        details: {
            groupId: trip.group.id,
            tripId: trip.id,
            before: null,
            after: serializeTransactionAuditSnapshot({
                id: transaction.id,
                tripId: transaction.trip.id,
                tripTitle: transaction.trip.title,
                title,
                amount: transaction.amount,
                splitType: transaction.splitType,
                payerId: transaction.payerId,
                payerName: transaction.payer.name,
                createdAt: transaction.createdAt,
                updatedAt: transaction.updatedAt,
                deletedAt: transaction.deletedAt,
                splits: transaction.splits,
            }),
        },
    });

    // Send notifications to other group members
    try {
        const otherMemberIds = trip.group.members
            .map((m: { userId: string }) => m.userId)
            .filter((id: string) => id !== actor.id);

        if (otherMemberIds.length > 0) {
            const payerName = actor.name || 'Someone';
            const categoryLabel = CATEGORY_LABELS[category] || category;
            const amountFormatted = formatCurrency(amount);

            const rows = otherMemberIds.map((memberId: string) => ({
                userId: memberId,
                actorId: actor.id,
                type: 'new_expense',
                title: `💰 ${payerName} added an expense`,
                body: `${payerName} added ${amountFormatted} for category: ${categoryLabel}`,
                link: `/groups/${trip.group.id}`,
            }));
            await prisma.notification.createMany({ data: rows });
            pushToPhones(rows);
        }
    } catch {
        // Notification failure shouldn't block the transaction
    }

    return { ok: true, expense: transaction, replayed: false };
}

export type DeleteExpenseOutcome =
    | { ok: true; groupId: string }
    | { ok: false; status: 404; error: string; code: 'not_found' };

/**
 * Deletes an expense as `actor`: a current member who paid it or owns the
 * group. A soft delete, so the history keeps it; of two deletes at once, one
 * lands. The other members are told.
 */
export async function deleteExpense(actor: { id: string; name: string | null }, id: string): Promise<DeleteExpenseOutcome> {
    const notFound = { ok: false, status: 404, error: 'Transaction not found or access denied', code: 'not_found' } as const;

    // Same rule as editing: a current member, and the payer or the owner.
    const transaction = await prisma.transaction.findFirst({
        where: {
            id,
            deletedAt: null,
            AND: [
                {
                    trip: {
                        group: {
                            deletedAt: null,
                            OR: [{ ownerId: actor.id }, { members: { some: { userId: actor.id } } }],
                        },
                    },
                },
                { OR: [{ payerId: actor.id }, { trip: { group: { ownerId: actor.id } } }] },
            ],
        },
        include: {
            payer: { select: { id: true, name: true } },
            splits: { include: { user: { select: { id: true, name: true } } } },
            trip: {
                include: {
                    group: {
                        include: { members: true },
                    },
                },
            },
        },
    });
    if (!transaction) return notFound;

    const amountFormatted = `₹${(transaction.amount / 100).toLocaleString('en-IN')}`;

    // 1. Soft-delete the transaction (preserve data). Only one of two
    // simultaneous deletes lands, so the history records one deletion.
    const deleted = await prisma.transaction.updateMany({
        where: { id, deletedAt: null },
        data: { deletedAt: new Date() },
    });
    if (deleted.count !== 1) return notFound;

    await createAuditLog({
        userId: actor.id,
        action: 'delete',
        entityType: 'transaction',
        entityId: transaction.id,
        details: {
            groupId: transaction.trip.group.id,
            tripId: transaction.tripId,
            before: serializeTransactionAuditSnapshot({
                id: transaction.id,
                tripId: transaction.tripId,
                tripTitle: transaction.trip.title,
                title: transaction.title,
                amount: transaction.amount,
                splitType: transaction.splitType,
                payerId: transaction.payerId,
                payerName: transaction.payer.name,
                createdAt: transaction.createdAt,
                updatedAt: transaction.updatedAt,
                deletedAt: transaction.deletedAt,
                splits: transaction.splits,
            }),
            after: null,
        },
    });

    // 2. Notify members that it was removed. (The "added" notification stays:
    // matching it by title text deleted unrelated notifications.)
    try {
        const otherMemberIds = transaction.trip.group.members
            .map((m: { userId: string }) => m.userId)
            .filter((mId: string) => mId !== actor.id);

        if (otherMemberIds.length > 0) {
            const deleterName = actor.name || 'Someone';
            const rows = otherMemberIds.map((memberId: string) => ({
                userId: memberId,
                actorId: actor.id,
                type: 'group_activity',
                title: `🗑️ ${deleterName} deleted an expense`,
                body: `${transaction.title} (${amountFormatted}) was removed from ${transaction.trip.group.name}.`,
                link: `/groups/${transaction.trip.group.id}`,
            }));
            await prisma.notification.createMany({ data: rows });
            pushToPhones(rows);
        }
    } catch {
        // Notification failure shouldn't block the transaction removal
    }

    return { ok: true, groupId: transaction.trip.group.id };
}

// ── Editing ─────────────────────────────────────────────────

export interface ExpenseEdit {
    title?: string;
    /** Paise. */
    amount?: number;
    category?: string;
    method?: string;
    description?: string;
    splitType?: SplitType;
    splitAmong?: string[];
    splits?: { userId: string; amount: number }[];
    /** The `updatedAt` the editor was looking at: if it changed since, someone else edited first. */
    expectedUpdatedAt?: string;
}

const EDITED_INCLUDE = {
    payer: { select: { id: true, name: true, image: true } },
    splits: { include: { user: { select: { id: true, name: true } } } },
    trip: { include: { group: { include: { members: true } } } },
} as const;
type EditedExpense = Prisma.TransactionGetPayload<{ include: typeof EDITED_INCLUDE }>;

export type UpdateExpenseOutcome =
    | { ok: true; expense: EditedExpense }
    | { ok: false; status: 400 | 404 | 409; error: string; code: 'not_found' | 'conflict' | 'bad_split' | 'nothing_to_change' };

/** Thrown inside the write when the row changed or disappeared since it was read. */
class EditConflict extends Error {}

const isKnownSplitType = (value: string): value is SplitType => (SPLIT_TYPES as readonly string[]).includes(value);

const sameMembers = (a: readonly string[], b: readonly string[]) => {
    const setA = new Set(a);
    return setA.size === a.length && a.length === b.length && b.every((userId) => setA.has(userId));
};

/** Whether the expense already holds everything the edit asks for. */
function alreadyAsAsked(
    existing: { title: string; category: string; method: string | null; description: string | null; amount: number; splitType: string; splits: { userId: string; amount: number }[] },
    edit: ExpenseEdit,
): boolean {
    const same = (a: { userId: string; amount: number }[], b: { userId: string; amount: number }[]) => {
        const key = (shares: { userId: string; amount: number }[]) => shares.map((share) => `${share.userId}:${share.amount}`).sort().join(',');
        return key(a) === key(b);
    };
    return (edit.title === undefined || edit.title === existing.title)
        && (edit.category === undefined || edit.category === existing.category)
        && (edit.method === undefined || edit.method === existing.method)
        && (edit.description === undefined || edit.description === existing.description)
        && (edit.amount === undefined || edit.amount === existing.amount)
        && (edit.splitType === undefined || edit.splitType === existing.splitType)
        && (edit.splitAmong === undefined || sameMembers(edit.splitAmong, existing.splits.map((split) => split.userId)))
        && (edit.splits === undefined || same(edit.splits.filter((share) => share.amount > 0), existing.splits));
}

const CONFLICT = { ok: false, status: 409, error: 'Someone else changed this expense while you were editing. Reload it and try again.', code: 'conflict' } as const;
const NOT_FOUND = { ok: false, status: 404, error: 'Transaction not found or access denied', code: 'not_found' } as const;

/**
 * Edits an expense as `actor`: a current member who paid it or owns the group.
 * Changing the amount or who shares it recomputes the shares by the same rules
 * as adding one (src/lib/expenseSplits.ts). The write lands only on the version
 * that was read, so two people editing at once can't overwrite each other, and
 * `expectedUpdatedAt` refuses an edit made to an older copy. The other members
 * are told.
 */
export async function updateExpense(actor: { id: string; name: string | null }, id: string, edit: ExpenseEdit): Promise<UpdateExpenseOutcome> {
    // Only a current member may edit, and only the payer or the group owner.
    // Membership is checked too: someone removed from the group loses the
    // right to change what they paid for.
    const existing = await prisma.transaction.findFirst({
        where: {
            id,
            deletedAt: null,
            AND: [
                {
                    trip: {
                        group: {
                            deletedAt: null,
                            OR: [{ ownerId: actor.id }, { members: { some: { userId: actor.id } } }],
                        },
                    },
                },
                { OR: [{ payerId: actor.id }, { trip: { group: { ownerId: actor.id } } }] },
            ],
        },
        include: {
            payer: { select: { id: true, name: true } },
            trip: { include: { group: { include: { members: true } } } },
            splits: { include: { user: { select: { id: true, name: true } } } },
        },
    });
    if (!existing) return NOT_FOUND;

    if (edit.expectedUpdatedAt && new Date(edit.expectedUpdatedAt).getTime() !== existing.updatedAt.getTime()) {
        // A retry of an edit that already landed (its answer was lost on the way to the phone)
        // finds the expense just as it asked: that is done, not a conflict. Anything else is.
        if (!alreadyAsAsked(existing, edit)) return CONFLICT;
        const current = await prisma.transaction.findUnique({ where: { id }, include: EDITED_INCLUDE });
        return current ? { ok: true, expense: current } : NOT_FOUND;
    }

    // Any change to the amount or to who shares it recomputes the shares
    // under the same rules as creating an expense (lib/expenseSplits.ts), so
    // the shares always add up to the saved amount and only members are charged.
    // Fields sent unchanged (an edit form sends everything) change nothing.
    const amount = edit.amount ?? existing.amount;
    const currentType: SplitType = isKnownSplitType(existing.splitType) ? existing.splitType : 'custom';
    const splitType = edit.splitType ?? currentType;
    const currentSharers = existing.splits.map((split) => split.userId);
    const sharesTouched = amount !== existing.amount
        || splitType !== currentType
        || (edit.splitAmong !== undefined && !sameMembers(edit.splitAmong, currentSharers))
        || edit.splits !== undefined;

    let newSplits: { userId: string; amount: number }[] | null = null;
    if (sharesTouched) {
        if (splitType !== 'equal' && edit.splits === undefined) {
            return { ok: false, status: 400, error: `Changing a ${splitType} split needs the new amount each member owes`, code: 'bad_split' };
        }
        const memberIds = existing.trip.group.members.map((member) => member.userId);
        const resolution = resolveSplits({
            amount,
            splitType,
            splitAmong: edit.splitAmong ?? currentSharers,
            splits: edit.splits,
        }, memberIds);
        if (!resolution.ok) return { ok: false, status: 400, error: resolution.error, code: 'bad_split' };
        newSplits = resolution.splits;
    }

    const updateData = {
        ...(edit.title !== undefined && edit.title !== existing.title ? { title: edit.title } : {}),
        ...(edit.category !== undefined && edit.category !== existing.category ? { category: edit.category } : {}),
        ...(edit.method !== undefined && edit.method !== existing.method ? { method: edit.method } : {}),
        ...(edit.description !== undefined && edit.description !== existing.description ? { description: edit.description } : {}),
        ...(newSplits ? { amount, splitType } : {}),
    };
    if (Object.keys(updateData).length === 0) return { ok: false, status: 400, error: 'Nothing to change', code: 'nothing_to_change' };

    // The write only lands on the version that was read: two people editing
    // at once can't silently overwrite each other's change.
    try {
        await prisma.$transaction(async (tx) => {
            const written = await tx.transaction.updateMany({
                where: { id, deletedAt: null, updatedAt: existing.updatedAt },
                data: updateData,
            });
            if (written.count !== 1) throw new EditConflict();

            if (newSplits) {
                await tx.splitItem.deleteMany({ where: { transactionId: id } });
                await tx.splitItem.createMany({
                    data: newSplits.map((split) => ({ transactionId: id, userId: split.userId, amount: split.amount })),
                });
            }
        });
    } catch (error) {
        if (error instanceof EditConflict) return CONFLICT;
        throw error;
    }

    const full = await prisma.transaction.findUnique({ where: { id }, include: EDITED_INCLUDE });
    if (!full) return NOT_FOUND;

    await createAuditLog({
        userId: actor.id,
        action: 'update',
        entityType: 'transaction',
        entityId: full.id,
        details: {
            groupId: full.trip.group.id,
            tripId: full.tripId,
            before: serializeTransactionAuditSnapshot({
                id: existing.id,
                tripId: existing.tripId,
                tripTitle: existing.trip.title,
                title: existing.title,
                amount: existing.amount,
                splitType: existing.splitType,
                payerId: existing.payerId,
                payerName: existing.payer.name,
                createdAt: existing.createdAt,
                updatedAt: existing.updatedAt,
                deletedAt: existing.deletedAt,
                splits: existing.splits,
            }),
            after: serializeTransactionAuditSnapshot({
                id: full.id,
                tripId: full.tripId,
                tripTitle: full.trip.title,
                title: full.title,
                amount: full.amount,
                splitType: full.splitType,
                payerId: full.payerId,
                payerName: full.payer.name,
                createdAt: full.createdAt,
                updatedAt: full.updatedAt,
                deletedAt: full.deletedAt,
                splits: full.splits,
            }),
        },
    });

    // Notify all group members about the edit
    try {
        const editorName = actor.name || 'Someone';
        const amountStr = `₹${(full.amount / 100).toLocaleString('en-IN')}`;
        const otherIds = full.trip.group.members
            .map((m: { userId: string }) => m.userId)
            .filter((mId: string) => mId !== actor.id);

        if (otherIds.length > 0) {
            const rows = otherIds.map((memberId: string) => ({
                userId: memberId,
                actorId: actor.id,
                type: 'group_activity',
                title: `✏️ ${editorName} edited an expense`,
                body: `"${full.title}" updated to ${amountStr} in ${full.trip.group.name}.`,
                link: `/groups/${full.trip.group.id}`,
            }));
            await prisma.notification.createMany({ data: rows });
            pushToPhones(rows);
        }
    } catch {
        // Notification failure shouldn't block the response
    }

    return { ok: true, expense: full };
}
