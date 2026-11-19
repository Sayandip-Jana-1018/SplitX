import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { z } from 'zod';
import { MAX_EXPENSE_PAISE, SPLIT_TYPES } from '@/lib/expenseSplits';
import { logger } from '@/lib/logger';
import { withViewableReceipts } from '@/lib/receiptAccess';
import { deleteExpense, updateExpense } from '@/lib/services/expenses';

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

        const user = await prisma.user.findUnique({ where: { email: session.user.email } });
        if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

        // The rules (who may edit, recomputed shares, no lost edits) live in the
        // service, shared with the phone app's PATCH /api/v1/expenses/:id.
        const outcome = await updateExpense(user, id, parsed.data);
        if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
        return NextResponse.json(outcome.expense);
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

        // The rules themselves are shared with the phone app (lib/services/expenses.ts).
        const outcome = await deleteExpense(user, id);
        if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
        return NextResponse.json({ message: 'Transaction deleted' });
    } catch (error) {
        logger.error('Failed to delete transaction', { err: error });
        return NextResponse.json({ error: 'Failed to delete transaction' }, { status: 500 });
    }
}
