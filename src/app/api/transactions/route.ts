import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { z } from 'zod';

const CreateTransactionSchema = z.object({
    tripId: z.string().cuid(),
    title: z.string().min(1).max(100),
    amount: z.number().int().positive(), // paise
    category: z.string().default('other'),
    method: z.string().default('cash'),
    description: z.string().optional(),
    splitType: z.enum(['equal', 'percentage', 'custom']).default('equal'),
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

        const { title, amount, category, method, description, splitType, splits } = parsed.data;

        // Calculate splits
        let splitData: { userId: string; amount: number }[] = [];

        if (splitType === 'equal') {
            const memberIds: string[] = trip.group.members.map((m: { userId: string }) => m.userId);
            const perPerson = Math.floor(amount / memberIds.length);
            const remainder = amount - perPerson * memberIds.length;
            splitData = memberIds.map((id: string, i: number) => ({
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

        return NextResponse.json(transaction, { status: 201 });
    } catch (error) {
        return NextResponse.json({ error: 'Failed to create transaction' }, { status: 500 });
    }
}
