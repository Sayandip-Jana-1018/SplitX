import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { z } from 'zod';
import { createAuditLog } from '@/lib/auditLog';
import { serializeTransactionAuditSnapshot } from '@/lib/auditPayloads';

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
    title: z.string().min(1).max(100),
    amount: z.number().int().positive(), // paise
    category: z.string().default('other'),
    method: z.string().default('cash'),
    description: z.string().optional(),
    receiptUrl: z.string().url().optional(),
    payerId: z.string().optional(), // who paid — defaults to logged-in user
    splitType: z.enum(['equal', 'percentage', 'custom']).default('equal'),
    splitAmong: z.array(z.string()).optional(), // subset of member IDs to split among
    splits: z.array(z.object({
        userId: z.string().cuid(),
        amount: z.number().int().nonnegative(),
    })).optional(),
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
            return NextResponse.json(transactions);
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

        return NextResponse.json(transactions);
    } catch {
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

        const body = await req.json();
        const parsed = CreateTransactionSchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
        }

        const user = await prisma.user.findUnique({ where: { email: session.user.email } });
        if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

        // Verify trip exists and user has access
        const trip = await prisma.trip.findFirst({
            where: {
                id: parsed.data.tripId,
                group: {
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

        const { title, amount, category, method, description, splitType, splitAmong, splits, payerId: requestedPayerId } = parsed.data;

        // Determine actual payer — use request payerId if valid, otherwise logged-in user
        const allMemberIds: string[] = trip.group.members.map((m: { userId: string }) => m.userId);
        const actualPayerId = (requestedPayerId && allMemberIds.includes(requestedPayerId))
            ? requestedPayerId
            : user.id;

        // Calculate splits
        let splitData: { userId: string; amount: number }[] = [];

        if (splitType === 'equal') {
            // Use splitAmong if provided, otherwise all group members
            const targetIds = splitAmong && splitAmong.length > 0
                ? allMemberIds.filter(id => splitAmong.includes(id))
                : allMemberIds;

            if (targetIds.length === 0) {
                return NextResponse.json({ error: 'At least one member must be included in the split' }, { status: 400 });
            }

            const perPerson = Math.floor(amount / targetIds.length);
            const remainder = amount - perPerson * targetIds.length;
            splitData = targetIds.map((id: string, i: number) => ({
                userId: id,
                amount: perPerson + (i === 0 ? remainder : 0),
            }));
        } else if (splits) {
            // Validate custom splits sum to total
            const splitTotal = splits.reduce((sum, s) => sum + s.amount, 0);
            if (splitTotal !== amount) {
                return NextResponse.json(
                    { error: `Split amounts (${splitTotal}) must equal the transaction total (${amount})` },
                    { status: 400 }
                );
            }
            // Validate all split user IDs are group members
            const invalidUsers = splits.filter(s => !allMemberIds.includes(s.userId));
            if (invalidUsers.length > 0) {
                return NextResponse.json(
                    { error: 'One or more split users are not members of this group' },
                    { status: 400 }
                );
            }
            splitData = splits;
        }

        // Create transaction + splits atomically
        const transaction = await prisma.transaction.create({
            data: {
                tripId: parsed.data.tripId,
                payerId: actualPayerId,
                title,
                amount,
                category,
                method,
                description,
                splitType,
                splits: {
                    create: splitData.map((s) => ({
                        userId: s.userId,
                        amount: s.amount,
                    })),
                },
            },
            include: {
                splits: { include: { user: { select: { id: true, name: true } } } },
                payer: { select: { id: true, name: true } },
                trip: { select: { id: true, title: true } },
            },
        });

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
    } catch {
        return NextResponse.json({ error: 'Failed to create transaction' }, { status: 500 });
    }
}

