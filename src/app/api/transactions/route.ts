import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { z } from 'zod';
import { createAuditLog } from '@/lib/auditLog';
import { serializeTransactionAuditSnapshot } from '@/lib/auditPayloads';
import { recordTransactionCreated } from '@/lib/metrics';
import { withViewableReceipts } from '@/lib/receiptAccess';
import { isOwnReceiptUrl, isTrustedReceiptUrl } from '@/lib/receiptUrl';
import { logger } from '@/lib/logger';
import { MAX_EXPENSE_PAISE, resolveSplits, SPLIT_TYPES } from '@/lib/expenseSplits';
import { IDEMPOTENCY_KEY_PATTERN } from '@/lib/idempotency';

/** What a created expense is answered with, the first time and on any repeat. */
const CREATED_INCLUDE = {
    splits: { include: { user: { select: { id: true, name: true } } } },
    payer: { select: { id: true, name: true } },
    trip: { select: { id: true, title: true } },
} as const;

/** The expense an earlier save with this key made: answered as it was, nothing added. */
const replay = (transaction: unknown) =>
    NextResponse.json(transaction, { status: 200, headers: { 'Idempotency-Replayed': 'true' } });

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

const CreateTransactionSchema = z.object({
    tripId: z.string().cuid(),
    title: z.string().trim().min(1).max(100),
    amount: z.number().int().positive().max(MAX_EXPENSE_PAISE), // paise
    category: z.string().min(1).max(40).default('other'),
    method: z.string().min(1).max(40).default('cash'),
    description: z.string().max(500).optional(),
    receiptUrl: z.string().refine(isTrustedReceiptUrl, { message: 'receiptUrl must point to SplitX receipt storage' }).optional(),
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
        const limit = parseInt(searchParams.get('limit') || '50', 10);

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
        if (idempotencyKey) {
            const earlier = await prisma.transaction.findUnique({ where: { idempotencyKey }, include: CREATED_INCLUDE });
            if (earlier) return replay(earlier);
        }

        // Uploads land in the uploader's own folder: a new expense can't borrow someone else's photo.
        if (parsed.data.receiptUrl && !isOwnReceiptUrl(parsed.data.receiptUrl, user.id)) {
            return NextResponse.json({ error: 'Attach a receipt photo you uploaded' }, { status: 400 });
        }

        // Verify trip exists and user has access
        const trip = await prisma.trip.findFirst({
            where: {
                id: parsed.data.tripId,
                group: {
                    deletedAt: null,
                    OR: [
                        { ownerId: user.id },
                        { members: { some: { userId: user.id } } },
                    ],
                },
            },
            include: {
                group: { include: { members: true } },
            },
        });

        if (!trip) {
            return NextResponse.json({ error: 'Trip not found or access denied' }, { status: 404 });
        }

        const { title, amount, category, method, description, receiptUrl, splitType, splitAmong, splits, payerId: requestedPayerId } = parsed.data;

        // The payer must be a member. An unknown payer is refused rather than
        // quietly replaced by the person saving the expense.
        const allMemberIds: string[] = trip.group.members.map((m: { userId: string }) => m.userId);
        if (requestedPayerId && !allMemberIds.includes(requestedPayerId)) {
            return NextResponse.json({ error: 'The payer must be a current member of the group' }, { status: 400 });
        }
        const actualPayerId = requestedPayerId ?? user.id;

        // The same rules as editing (lib/expenseSplits.ts): members only, each
        // once, adding up to the amount exactly.
        const resolution = resolveSplits({ amount, splitType, splitAmong, splits }, allMemberIds);
        if (!resolution.ok) {
            return NextResponse.json({ error: resolution.error }, { status: 400 });
        }
        const splitData = resolution.splits;

        // Create transaction + splits atomically
        let transaction;
        try {
            transaction = await prisma.transaction.create({
                data: {
                    tripId: parsed.data.tripId,
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
                if (earlier) return replay(earlier);
            }
            throw error;
        }
        // Expenses carrying a receipt come from the scan flow.
        recordTransactionCreated(receiptUrl ? 'receipt' : 'manual', category, transaction.amount);

        await createAuditLog({
            userId: user.id,
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
                .filter((id: string) => id !== user.id);

            if (otherMemberIds.length > 0) {
                const payerName = user.name || 'Someone';
                const categoryLabel = CATEGORY_LABELS[category] || category;
                const amountFormatted = `₹${(amount / 100).toLocaleString('en-IN')}`;

                await prisma.notification.createMany({
                    data: otherMemberIds.map((memberId: string) => ({
                        userId: memberId,
                        actorId: user.id,
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

        return NextResponse.json(transaction, { status: 201 });
    } catch (error) {
        logger.error('Failed to create transaction', { err: error });
        return NextResponse.json({ error: 'Failed to create transaction' }, { status: 500 });
    }
}

