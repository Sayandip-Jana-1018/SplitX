import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { z } from 'zod';
import { withViewableReceipts } from '@/lib/receiptAccess';
import { isTrustedReceiptUrl } from '@/lib/receiptUrl';
import { logger } from '@/lib/logger';
import { MAX_EXPENSE_PAISE, SPLIT_TYPES } from '@/lib/expenseSplits';
import { IDEMPOTENCY_KEY_PATTERN } from '@/lib/idempotency';
import { createExpense } from '@/lib/services/expenses';

/** The expense an earlier save with this key made: answered as it was, nothing added. */
const replay = (transaction: unknown) =>
    NextResponse.json(transaction, { status: 200, headers: { 'Idempotency-Replayed': 'true' } });

const CreateTransactionSchema = z.object({
    tripId: z.string().cuid(),
    title: z.string().trim().min(1).max(100),
    amount: z.number().int().positive().max(MAX_EXPENSE_PAISE), // paise
    category: z.string().min(1).max(40).default('other'),
    method: z.string().min(1).max(40).default('cash'),
    description: z.string().max(500).optional(),
    receiptUrl: z.string().refine(isTrustedReceiptUrl, { message: 'receiptUrl must point to SplitIT receipt storage' }).optional(),
    payerId: z.string().max(64).optional(), // who paid — defaults to logged-in user
    splitType: z.enum(SPLIT_TYPES).default('equal'),
    splitAmong: z.array(z.string().min(1).max(64)).max(200).optional(), // subset of member IDs to split among
    splits: z.array(z.object({
        userId: z.string().cuid(),
        amount: z.number().int().nonnegative(),
    })).max(200).optional(),
});

// GET /api/transactions?tripId=xxx  OR  /api/transactions?limit=N (auto-detect trips)
export async function GET(req: Request) {
    try {
        const session = await auth();
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(req.url);
        const tripId = searchParams.get('tripId');
        const limit = Number.parseInt(searchParams.get('limit') || '50', 10);

        // If tripId is provided, use it directly
        if (tripId) {
            const user = await prisma.user.findUnique({ where: { email: session.user.email } });
            if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

            const accessibleTrip = await prisma.trip.findFirst({
                where: {
                    id: tripId,
                    group: {
                        deletedAt: null,
                        OR: [
                            { ownerId: user.id },
                            { members: { some: { userId: user.id } } },
                        ],
                    },
                },
                select: { id: true },
            });

            if (!accessibleTrip) {
                return NextResponse.json({ error: 'Trip not found or access denied' }, { status: 404 });
            }

            const transactions = await prisma.transaction.findMany({
                where: { tripId, deletedAt: null },
                include: {
                    payer: { select: { id: true, name: true, image: true } },
                    splits: {
                        include: { user: { select: { id: true, name: true } } },
                    },
                    trip: {
                        select: {
                            group: {
                                select: { ownerId: true, members: { include: { user: { select: { id: true, name: true, image: true } } } } }
                            }
                        }
                    }
                },
                orderBy: { createdAt: 'desc' },
                take: limit,
            });
            return NextResponse.json(await withViewableReceipts(transactions));
        }

        // No tripId — auto-discover all trips for this user's groups
        const user = await prisma.user.findUnique({ where: { email: session.user.email } });
        if (!user) return NextResponse.json([], { status: 200 });

        const trips = await prisma.trip.findMany({
            where: {
                group: {
                    deletedAt: null,
                    OR: [
                        { ownerId: user.id },
                        { members: { some: { userId: user.id } } },
                    ],
                },
            },
            select: { id: true },
        });

        if (trips.length === 0) return NextResponse.json([]);

        const transactions = await prisma.transaction.findMany({
            where: { tripId: { in: trips.map(t => t.id) }, deletedAt: null },
            include: {
                payer: { select: { id: true, name: true, image: true } },
                splits: {
                    include: { user: { select: { id: true, name: true } } },
                },
                trip: {
                    select: {
                        group: {
                            select: { ownerId: true, members: { include: { user: { select: { id: true, name: true, image: true } } } } }
                        }
                    }
                }
            },
            orderBy: { createdAt: 'desc' },
            take: limit,
        });

        return NextResponse.json(await withViewableReceipts(transactions));
    } catch (error) {
        logger.error('Failed to fetch transactions', { err: error });
        return NextResponse.json({ error: 'Failed to fetch transactions' }, { status: 500 });
    }
}

// POST /api/transactions — create a transaction with splits
export async function POST(req: Request) {
    try {
        const session = await auth();
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const parsed = CreateTransactionSchema.safeParse(await req.json().catch(() => null));
        if (!parsed.success) {
            const issue = parsed.error.issues[0];
            return NextResponse.json(
                { error: issue ? `Invalid ${issue.path.join('.') || 'request'}: ${issue.message}` : 'Invalid request' },
                { status: 400 }
            );
        }

        const user = await prisma.user.findUnique({ where: { email: session.user.email } });
        if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

        // A save the client repeats (a double tap, or a retry after the answer
        // was lost) carries the same key: answer it with the expense the first
        // one made. Stored with the saver's id, so no one else's key can match.
        const clientKey = req.headers.get('idempotency-key');
        if (clientKey !== null && !IDEMPOTENCY_KEY_PATTERN.test(clientKey)) {
            return NextResponse.json({ error: 'Idempotency-Key must be 16 to 100 letters, digits, - or _' }, { status: 400 });
        }
        const idempotencyKey = clientKey === null ? null : `${user.id}:${clientKey}`;

        // The rules themselves are shared with the phone app (lib/services/expenses.ts).
        const outcome = await createExpense(user, parsed.data, idempotencyKey);
        if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
        if (outcome.replayed) return replay(outcome.expense);
        return NextResponse.json(outcome.expense, { status: 201 });
    } catch (error) {
        logger.error('Failed to create transaction', { err: error });
        return NextResponse.json({ error: 'Failed to create transaction' }, { status: 500 });
    }
}
