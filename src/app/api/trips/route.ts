import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { z } from 'zod';

const CreateTripSchema = z.object({
    groupId: z.string().cuid(),
    title: z.string().min(1).max(100),
    description: z.string().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
});

// GET /api/trips?groupId=xxx
export async function GET(req: Request) {
    try {
        const session = await auth();
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(req.url);
        const groupId = searchParams.get('groupId');
        if (!groupId) {
            return NextResponse.json({ error: 'groupId required' }, { status: 400 });
        }

        // Verify user is a member/owner of the group
        const user = await prisma.user.findUnique({ where: { email: session.user.email } });
        if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

        const group = await prisma.group.findFirst({
            where: {
                id: groupId,
                deletedAt: null,
                OR: [
                    { ownerId: user.id },
                    { members: { some: { userId: user.id } } },
                ],
            },
            select: { id: true },
        });
        if (!group) {
            return NextResponse.json({ error: 'Group not found or access denied' }, { status: 404 });
        }

        const trips = await prisma.trip.findMany({
            where: { groupId },
            include: {
                _count: { select: { transactions: true, settlements: true } },
            },
            orderBy: { createdAt: 'desc' },
        });

        return NextResponse.json(trips);
    } catch {
        return NextResponse.json({ error: 'Failed to fetch trips' }, { status: 500 });
    }
}

// POST /api/trips
export async function POST(req: Request) {
    try {
        const session = await auth();
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await req.json();
        const parsed = CreateTripSchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
        }

        const user = await prisma.user.findUnique({ where: { email: session.user.email } });
        if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

        const group = await prisma.group.findFirst({
            where: {
                id: parsed.data.groupId,
                deletedAt: null,
                OR: [
                    { ownerId: user.id },
                    { members: { some: { userId: user.id } } },
                ],
            },
            select: { id: true },
        });

        if (!group) {
            return NextResponse.json({ error: 'Group not found or access denied' }, { status: 404 });
        }

        const trip = await prisma.trip.create({
            data: {
                groupId: parsed.data.groupId,
                title: parsed.data.title,
                description: parsed.data.description,
                startDate: parsed.data.startDate ? new Date(parsed.data.startDate) : undefined,
                endDate: parsed.data.endDate ? new Date(parsed.data.endDate) : undefined,
            },
        });

        return NextResponse.json(trip, { status: 201 });
    } catch {
        return NextResponse.json({ error: 'Failed to create trip' }, { status: 500 });
    }
}
