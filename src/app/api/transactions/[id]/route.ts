import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { z } from 'zod';
import { createAuditLog } from '@/lib/auditLog';
import { serializeTransactionAuditSnapshot } from '@/lib/auditPayloads';

const UpdateTransactionSchema = z.object({
    title: z.string().min(1).max(100).optional(),
    amount: z.number().int().positive().optional(),
    category: z.string().optional(),
    method: z.string().optional(),
    description: z.string().optional(),
    splitAmong: z.array(z.string()).optional(),
});

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

        return NextResponse.json(transaction);
    } catch {
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
        const body = await req.json();
        const parsed = UpdateTransactionSchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
        }

        const user = await prisma.user.findUnique({ where: { email: session.user.email } });
        if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

        // Verify access — must be payer or group owner, and not soft-deleted
        const existing = await prisma.transaction.findFirst({
            where: {
                id,
                deletedAt: null,
                OR: [
                    { payerId: user.id },
                    { trip: { group: { ownerId: user.id } } },
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

        if (existing.splitType === 'custom') {
            return NextResponse.json(
                { error: 'Custom split transactions cannot be edited. Delete and recreate the expense instead.' },
                { status: 400 }
            );
        }

        // If amount changed, recalculate equal splits
        const updateData: Record<string, unknown> = {};
        if (parsed.data.title) updateData.title = parsed.data.title;
        if (parsed.data.amount !== undefined) updateData.amount = parsed.data.amount;
        if (parsed.data.category) updateData.category = parsed.data.category;
        if (parsed.data.method) updateData.method = parsed.data.method;
        if (parsed.data.description !== undefined) updateData.description = parsed.data.description;

        // Update transaction
        await prisma.$transaction(async (tx) => {
            const txn = await tx.transaction.update({
                where: { id },
                data: updateData,
            });

            // If amount or splitAmong changed, recalculate splits for equal split
            if ((parsed.data.amount || parsed.data.splitAmong) && existing.splitType === 'equal') {
                const memberIds = parsed.data.splitAmong || existing.splits.map((s: { userId: string }) => s.userId);
                const totalAmount = parsed.data.amount || existing.amount;

                if (memberIds.length > 0) {
                    const perPerson = Math.floor(totalAmount / memberIds.length);
                    const remainder = totalAmount - perPerson * memberIds.length;

                    // Delete old splits and create new
                    await tx.splitItem.deleteMany({ where: { transactionId: id } });
                    await tx.splitItem.createMany({
                        data: memberIds.map((userId: string, i: number) => ({
                            transactionId: id,
                            userId,
                            amount: perPerson + (i === 0 ? remainder : 0),
                        })),
                    });
                }
            }

            return txn;
        });

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
        console.error('Update transaction error:', error);
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

        const transaction = await prisma.transaction.findFirst({
            where: {
                id,
                deletedAt: null,
                OR: [
                    { payerId: user.id },
                    { trip: { group: { ownerId: user.id } } },
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

        // 1. Soft-delete the transaction (preserve data)
        await prisma.transaction.update({
            where: { id },
            data: { deletedAt: new Date() },
        });

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

        // 2. Best-effort to clean up old "added" notification
        try {
            await prisma.notification.deleteMany({
                where: {
                    type: 'new_expense',
                    link: `/groups/${transaction.trip.group.id}`,
                    body: { contains: transaction.title },
                },
            });
        } catch {
            // ignore non-fatal error
        }

        // 3. Notify members that it was removed
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
    } catch {
        return NextResponse.json({ error: 'Failed to delete transaction' }, { status: 500 });
    }
}
