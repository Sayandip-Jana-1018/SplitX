import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { invalidInput } from '@/lib/invalidInput';
import { createGroup } from '@/lib/services/groups';

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
                deletedAt: null,
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
        logger.error('Failed to fetch groups', { err: error });
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

        const parsed = CreateGroupSchema.safeParse(await req.json().catch(() => null));
        if (!parsed.success) return invalidInput(parsed.error);

        const user = await prisma.user.findUnique({ where: { email: session.user.email } });
        if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

        const group = await createGroup(user.id, parsed.data);

        return NextResponse.json(group, { status: 201 });
    } catch (error) {
        logger.error('Failed to create group', { err: error });
        return NextResponse.json({ error: 'Failed to create group' }, { status: 500 });
    }
}
