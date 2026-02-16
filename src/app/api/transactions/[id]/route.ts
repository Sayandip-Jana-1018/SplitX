import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { z } from 'zod';

const UpdateTransactionSchema = z.object({
    title: z.string().min(1).max(100).optional(),
    amount: z.number().int().positive().optional(),
    category: z.string().optional(),
    method: z.string().optional(),
    description: z.string().optional(),
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
    } catch (error) {
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

        // Verify access — must be payer or group owner
        const existing = await prisma.transaction.findFirst({
            where: {
                id,
                OR: [
                    { payerId: user.id },
                    { trip: { group: { ownerId: user.id } } },
                ],
            },
            include: {
                trip: { include: { group: { include: { members: true } } } },
            },
        });

        if (!existing) {
            return NextResponse.json({ error: 'Transaction not found or access denied' }, { status: 404 });
        }

        // If amount changed, recalculate equal splits
        const updateData: Record<string, unknown> = {};
        if (parsed.data.title) updateData.title = parsed.data.title;
        if (parsed.data.amount) updateData.amount = parsed.data.amount;
        if (parsed.data.category) updateData.category = parsed.data.category;
        if (parsed.data.method) updateData.method = parsed.data.method;
        if (parsed.data.description !== undefined) updateData.description = parsed.data.description;

        // Update transaction
        const updated = await prisma.$transaction(async (tx) => {
            const txn = await tx.transaction.update({
                where: { id },
                data: updateData,
            });

            // If amount changed, recalculate splits for equal split
            if (parsed.data.amount && existing.splitType === 'equal') {
                const memberIds = existing.trip.group.members.map(m => m.userId);
                const perPerson = Math.floor(parsed.data.amount / memberIds.length);
                const remainder = parsed.data.amount - perPerson * memberIds.length;

                // Delete old splits and create new
                await tx.splitItem.deleteMany({ where: { transactionId: id } });
                await tx.splitItem.createMany({
                    data: memberIds.map((userId, i) => ({
                        transactionId: id,
                        userId,
                        amount: perPerson + (i === 0 ? remainder : 0),
                    })),
                });
            }

            return txn;
        });

        const full = await prisma.transaction.findUnique({
            where: { id },
            include: {
                payer: { select: { id: true, name: true, image: true } },
                splits: { include: { user: { select: { id: true, name: true } } } },
            },
        });

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
                OR: [
                    { payerId: user.id },
                    { trip: { group: { ownerId: user.id } } },
                ],
            },
        });

        if (!transaction) {
            return NextResponse.json({ error: 'Transaction not found or access denied' }, { status: 404 });
        }

        await prisma.transaction.delete({ where: { id } });

        return NextResponse.json({ message: 'Transaction deleted' });
    } catch (error) {
        return NextResponse.json({ error: 'Failed to delete transaction' }, { status: 500 });
    }
}
