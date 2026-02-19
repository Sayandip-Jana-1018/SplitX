import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { z } from 'zod';

const CreateGroupSchema = z.object({
    name: z.string().min(1).max(50),
    emoji: z.string().default('✈️'),
});

// GET /api/groups — list groups for current user
export async function GET() {
    try {
        const session = await auth();
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const groups = await prisma.group.findMany({
            where: {
                OR: [
                    { owner: { email: session.user.email } },
                    { members: { some: { user: { email: session.user.email } } } },
                ],
            },
            include: {
                members: { include: { user: { select: { id: true, name: true, image: true } } } },
                _count: { select: { trips: true } },
                trips: {
                    select: {
                        transactions: {
                            where: { deletedAt: null },
                            select: { amount: true },
                        },
                    },
                },
            },
            orderBy: { updatedAt: 'desc' },
        });

        // Compute totalSpent per group from all trip transactions
        const enriched = groups.map(({ trips, ...g }) => ({
            ...g,
            totalSpent: trips.reduce(
                (sum, t) => sum + t.transactions.reduce((s, txn) => s + txn.amount, 0),
                0
            ),
        }));

        return NextResponse.json(enriched);
    } catch (error) {
        return NextResponse.json({ error: 'Failed to fetch groups' }, { status: 500 });
    }
}

// POST /api/groups — create a new group
export async function POST(req: Request) {
    try {
        const session = await auth();
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await req.json();
        const parsed = CreateGroupSchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
        }

        const user = await prisma.user.findUnique({ where: { email: session.user.email } });
        if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

        const group = await prisma.group.create({
            data: {
                name: parsed.data.name,
                emoji: parsed.data.emoji,
                ownerId: user.id,
                members: {
                    create: { userId: user.id, role: 'admin' },
                },
                // Auto-create a default trip so expenses can be added immediately
                trips: {
                    create: {
                        title: parsed.data.name,
                        isActive: true,
                        currency: 'INR',
                    },
                },
            },
        });

        return NextResponse.json(group, { status: 201 });
    } catch (error) {
        return NextResponse.json({ error: 'Failed to create group' }, { status: 500 });
    }
}
