import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { z } from 'zod';

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
                where: { tripId },
                include: {
                    payer: { select: { id: true, name: true, image: true } },
                    splits: {
                        include: { user: { select: { id: true, name: true } } },
                    },
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
            where: { tripId: { in: trips.map(t => t.id) } },
            include: {
                payer: { select: { id: true, name: true, image: true } },
                splits: {
                    include: { user: { select: { id: true, name: true } } },
                },
            },
            orderBy: { createdAt: 'desc' },
            take: limit,
        });

        return NextResponse.json(transactions);
    } catch (error) {
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

        const { title, amount, category, method, description, splitType, splitAmong, splits } = parsed.data;

        // Calculate splits
        let splitData: { userId: string; amount: number }[] = [];

        if (splitType === 'equal') {
            // Use splitAmong if provided, otherwise all group members
            const allMemberIds: string[] = trip.group.members.map((m: { userId: string }) => m.userId);
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
            splitData = splits;
        }

        // Create transaction + splits atomically
        const transaction = await prisma.transaction.create({
            data: {
                tripId: parsed.data.tripId,
                payerId: user.id,
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
                        type: 'new_expense',
                        title: `${payerName} added an expense`,
                        body: `${amountFormatted} for ${categoryLabel} — "${title}" in ${trip.group.name}`,
                        link: `/groups/${trip.group.id}`,
                    })),
                });
            }
        } catch {
            // Notification failure shouldn't block the transaction
        }

        return NextResponse.json(transaction, { status: 201 });
    } catch (error) {
        return NextResponse.json({ error: 'Failed to create transaction' }, { status: 500 });
    }
}

