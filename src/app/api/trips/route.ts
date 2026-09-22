import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { invalidInput } from '@/lib/invalidInput';

/**
 * A day like "2026-10-02" (or a full timestamp), read into a Date here: a
 * string the database can't read used to reach it and come back as a 500.
 */
const TripDate = z.string()
    .trim()
    .refine((value) => !Number.isNaN(Date.parse(value)), 'Use a date like 2026-10-02')
    .transform((value) => new Date(value))
    .refine((date) => date.getUTCFullYear() >= 2000 && date.getUTCFullYear() <= 2100, 'The date must be between 2000 and 2100');

const CreateTripSchema = z.object({
    groupId: z.string().cuid(),
    title: z.string().trim().min(1).max(100),
    description: z.string().trim().max(500).optional(),
    startDate: TripDate.optional(),
    endDate: TripDate.optional(),
}).refine(
    (trip) => !trip.startDate || !trip.endDate || trip.endDate >= trip.startDate,
    { message: 'The trip must end on or after the day it starts', path: ['endDate'] },
);

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
    } catch (error) {
        logger.error('Failed to fetch trips', { err: error });
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

        const parsed = CreateTripSchema.safeParse(await req.json().catch(() => null));
        if (!parsed.success) return invalidInput(parsed.error);

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
                startDate: parsed.data.startDate,
                endDate: parsed.data.endDate,
            },
        });

        return NextResponse.json(trip, { status: 201 });
    } catch (error) {
        logger.error('Failed to create trip', { err: error });
        return NextResponse.json({ error: 'Failed to create trip' }, { status: 500 });
    }
}
