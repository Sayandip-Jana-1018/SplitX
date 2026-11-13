import { Prisma } from '@prisma/client';
import { createAuditLog } from '@/lib/auditLog';
import { serializeTransactionAuditSnapshot } from '@/lib/auditPayloads';
import { prisma } from '@/lib/db';
import { resolveSplits, type SplitType } from '@/lib/expenseSplits';
import { recordTransactionCreated } from '@/lib/metrics';
import { isOwnReceiptUrl } from '@/lib/receiptUrl';
import { formatCurrency } from '@/lib/utils';

/**
 * Adding an expense, for every caller: the website (POST /api/transactions)
 * and the phone app (POST /api/v1/expenses). The rules live here once, so the
 * two can't drift (docs/mobile/ROADMAP.md, Phase 2 step 3).
 */

/** What a created expense is answered with, the first time and on any repeat. */
const CREATED_INCLUDE = {
    splits: { include: { user: { select: { id: true, name: true } } } },
    payer: { select: { id: true, name: true } },
    trip: { select: { id: true, title: true } },
} as const;

export type CreatedExpense = Prisma.TransactionGetPayload<{ include: typeof CREATED_INCLUDE }>;

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

            await prisma.notification.createMany({
                data: otherMemberIds.map((memberId: string) => ({
                    userId: memberId,
                    actorId: actor.id,
                    type: 'new_expense',
                    title: `💰 ${payerName} added an expense`,
                    body: `${payerName} added ${amountFormatted} for category: ${categoryLabel}`,
                    link: `/groups/${trip.group.id}`,
                })),
            });
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
            await prisma.notification.createMany({
                data: otherMemberIds.map((memberId: string) => ({
                    userId: memberId,
                    actorId: actor.id,
                    type: 'group_activity',
                    title: `🗑️ ${deleterName} deleted an expense`,
                    body: `${transaction.title} (${amountFormatted}) was removed from ${transaction.trip.group.name}.`,
                    link: `/groups/${transaction.trip.group.id}`,
                })),
            });
        }
    } catch {
        // Notification failure shouldn't block the transaction removal
    }

    return { ok: true, groupId: transaction.trip.group.id };
}
