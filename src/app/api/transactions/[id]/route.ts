import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { z } from 'zod';
import { createAuditLog } from '@/lib/auditLog';
import { serializeTransactionAuditSnapshot } from '@/lib/auditPayloads';
import { MAX_EXPENSE_PAISE, resolveSplits, SPLIT_TYPES, type SplitType } from '@/lib/expenseSplits';
import { logger } from '@/lib/logger';
import { withViewableReceipts } from '@/lib/receiptAccess';

const UpdateTransactionSchema = z.object({
    title: z.string().trim().min(1).max(100).optional(),
    amount: z.number().int().positive().max(MAX_EXPENSE_PAISE).optional(),
    category: z.string().min(1).max(40).optional(),
    method: z.string().min(1).max(40).optional(),
    description: z.string().max(500).optional(),
    splitType: z.enum(SPLIT_TYPES).optional(),
    splitAmong: z.array(z.string().min(1).max(64)).max(200).optional(),
    splits: z.array(z.object({
        userId: z.string().min(1).max(64),
        amount: z.number().int().nonnegative(),
    })).max(200).optional(),
    /** The `updatedAt` the editor was looking at: if it changed since, someone else edited first. */
    expectedUpdatedAt: z.string().datetime().optional(),
});

/** Thrown inside the write when the row changed or disappeared since it was read. */
class EditConflict extends Error {}

const isKnownSplitType = (value: string): value is SplitType => (SPLIT_TYPES as readonly string[]).includes(value);

const sameMembers = (a: readonly string[], b: readonly string[]) => {
    const setA = new Set(a);
    return setA.size === a.length && a.length === b.length && b.every((userId) => setA.has(userId));
};

// GET /api/transactions/[id] — get transaction detail
export async function GET(
    _req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const session = await auth();
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { id } = await params;
        const user = await prisma.user.findUnique({ where: { email: session.user.email } });
        if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

        const transaction = await prisma.transaction.findFirst({
            where: {
                id,
                deletedAt: null,
                trip: {
                    group: {
                        deletedAt: null,
                        OR: [
                            { ownerId: user.id },
                            { members: { some: { userId: user.id } } },
                        ],
                    },
                },
            },
            include: {
                payer: { select: { id: true, name: true, image: true } },
                splits: {
                    include: { user: { select: { id: true, name: true, image: true } } },
                },
                trip: {
                    select: {
                        id: true, title: true,
                        group: { select: { id: true, name: true, emoji: true } },
                    },
                },
            },
        });

        if (!transaction) {
            return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
        }

        const [viewable] = await withViewableReceipts([transaction]);
        return NextResponse.json(viewable);
    } catch (error) {
        logger.error('Failed to fetch transaction', { err: error });
        return NextResponse.json({ error: 'Failed to fetch transaction' }, { status: 500 });
    }
}

// PUT /api/transactions/[id] — update a transaction
export async function PUT(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const session = await auth();
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { id } = await params;
        const parsed = UpdateTransactionSchema.safeParse(await req.json().catch(() => null));
        if (!parsed.success) {
            const issue = parsed.error.issues[0];
            return NextResponse.json(
                { error: issue ? `Invalid ${issue.path.join('.') || 'request'}: ${issue.message}` : 'Invalid request' },
                { status: 400 }
            );
        }
        const edit = parsed.data;

        const user = await prisma.user.findUnique({ where: { email: session.user.email } });
        if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

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
                                OR: [{ ownerId: user.id }, { members: { some: { userId: user.id } } }],
                            },
                        },
                    },
                    { OR: [{ payerId: user.id }, { trip: { group: { ownerId: user.id } } }] },
                ],
            },
            include: {
                payer: { select: { id: true, name: true } },
                trip: { include: { group: { include: { members: true } } } },
                splits: { include: { user: { select: { id: true, name: true } } } },
            },
        });

        if (!existing) {
            return NextResponse.json({ error: 'Transaction not found or access denied' }, { status: 404 });
        }

        if (edit.expectedUpdatedAt && new Date(edit.expectedUpdatedAt).getTime() !== existing.updatedAt.getTime()) {
            return NextResponse.json(
                { error: 'Someone else changed this expense while you were editing. Reload it and try again.' },
                { status: 409 }
            );
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
                return NextResponse.json(
                    { error: `Changing a ${splitType} split needs the new amount each member owes` },
                    { status: 400 }
                );
            }
            const memberIds = existing.trip.group.members.map((member) => member.userId);
            const resolution = resolveSplits({
                amount,
                splitType,
                splitAmong: edit.splitAmong ?? currentSharers,
                splits: edit.splits,
            }, memberIds);
            if (!resolution.ok) {
                return NextResponse.json({ error: resolution.error }, { status: 400 });
            }
            newSplits = resolution.splits;
        }

        const updateData = {
            ...(edit.title !== undefined && edit.title !== existing.title ? { title: edit.title } : {}),
            ...(edit.category !== undefined && edit.category !== existing.category ? { category: edit.category } : {}),
            ...(edit.method !== undefined && edit.method !== existing.method ? { method: edit.method } : {}),
            ...(edit.description !== undefined && edit.description !== existing.description ? { description: edit.description } : {}),
            ...(newSplits ? { amount, splitType } : {}),
        };

        if (Object.keys(updateData).length === 0) {
            return NextResponse.json({ error: 'Nothing to change' }, { status: 400 });
        }

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
            if (error instanceof EditConflict) {
                return NextResponse.json(
                    { error: 'Someone else changed this expense while you were editing. Reload it and try again.' },
                    { status: 409 }
                );
            }
            throw error;
        }

        const full = await prisma.transaction.findUnique({
            where: { id },
            include: {
                payer: { select: { id: true, name: true, image: true } },
                splits: { include: { user: { select: { id: true, name: true } } } },
                trip: { include: { group: { include: { members: true } } } },
            },
        });

        if (full) {
            await createAuditLog({
                userId: user.id,
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
        }

        // Notify all group members about the edit
        if (full?.trip?.group?.members) {
            try {
                const editorName = user.name || 'Someone';
                const amountStr = `₹${(full.amount / 100).toLocaleString('en-IN')}`;
                const otherIds = full.trip.group.members
                    .map((m: { userId: string }) => m.userId)
                    .filter((mId: string) => mId !== user.id);

                if (otherIds.length > 0) {
                    await prisma.notification.createMany({
                        data: otherIds.map((memberId: string) => ({
                            userId: memberId,
                            actorId: user.id,
                            type: 'group_activity',
                            title: `✏️ ${editorName} edited an expense`,
                            body: `"${full.title}" updated to ${amountStr} in ${full.trip.group.name}.`,
                            link: `/groups/${full.trip.group.id}`,
                        })),
                    });
                }
            } catch {
                // Notification failure shouldn't block the response
            }
        }

        return NextResponse.json(full);
    } catch (error) {
        logger.error('Update transaction error', { err: error });
        return NextResponse.json({ error: 'Failed to update transaction' }, { status: 500 });
    }
}

// DELETE /api/transactions/[id] — delete a transaction
export async function DELETE(
    _req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const session = await auth();
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { id } = await params;

        const user = await prisma.user.findUnique({ where: { email: session.user.email } });
        if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

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
                                OR: [{ ownerId: user.id }, { members: { some: { userId: user.id } } }],
                            },
                        },
                    },
                    { OR: [{ payerId: user.id }, { trip: { group: { ownerId: user.id } } }] },
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

        if (!transaction) {
            return NextResponse.json({ error: 'Transaction not found or access denied' }, { status: 404 });
        }

        const amountFormatted = `₹${(transaction.amount / 100).toLocaleString('en-IN')}`;

        // 1. Soft-delete the transaction (preserve data). Only one of two
        // simultaneous deletes lands, so the history records one deletion.
        const deleted = await prisma.transaction.updateMany({
            where: { id, deletedAt: null },
            data: { deletedAt: new Date() },
        });
        if (deleted.count !== 1) {
            return NextResponse.json({ error: 'Transaction not found or access denied' }, { status: 404 });
        }

        await createAuditLog({
            userId: user.id,
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
                .filter((mId: string) => mId !== user.id);

            if (otherMemberIds.length > 0) {
                const deleterName = user.name || 'Someone';
                await prisma.notification.createMany({
                    data: otherMemberIds.map((memberId: string) => ({
                        userId: memberId,
                        actorId: user.id,
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

        return NextResponse.json({ message: 'Transaction deleted' });
    } catch (error) {
        logger.error('Failed to delete transaction', { err: error });
        return NextResponse.json({ error: 'Failed to delete transaction' }, { status: 500 });
    }
}
