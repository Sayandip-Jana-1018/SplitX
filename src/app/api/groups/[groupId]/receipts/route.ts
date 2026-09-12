import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { isTrustedReceiptUrl } from '@/lib/receiptUrl';
import { logger } from '@/lib/logger';

// GET /api/groups/[groupId]/receipts — get all transactions with receipt images for a group
export async function GET(
    _req: Request,
    { params }: { params: Promise<{ groupId: string }> }
) {
    try {
        const session = await auth();
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { groupId } = await params;

        // Verify user is a member/owner of the group
        const user = await prisma.user.findUnique({ where: { email: session.user.email } });
        if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

        const groupAccess = await prisma.group.findFirst({
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
        if (!groupAccess) {
            return NextResponse.json({ error: 'Group not found or access denied' }, { status: 404 });
        }

        // Get all trips for this group
        const trips = await prisma.trip.findMany({
            where: { groupId },
            select: { id: true },
        });

        if (trips.length === 0) {
            return NextResponse.json({ receipts: [], members: [] });
        }

        const tripIds = trips.map(t => t.id);

        // Get transactions with receipt URLs (non-deleted)
        const transactions = await prisma.transaction.findMany({
            where: {
                tripId: { in: tripIds },
                deletedAt: null,
                receiptUrl: { not: null },
            },
            select: {
                id: true,
                title: true,
                amount: true,
                category: true,
                receiptUrl: true,
                date: true,
                payer: {
                    select: { id: true, name: true, image: true },
                },
            },
            orderBy: { date: 'desc' },
        });

        // Get group members for filter
        const membersRaw = await prisma.groupMember.findMany({
            where: { groupId },
            include: { user: { select: { id: true, name: true, image: true } } },
        });

        const members = membersRaw.map(m => ({
            id: m.user.id,
            name: m.user.name || 'Unknown',
            image: m.user.image,
        }));

        const receipts = transactions
            .filter(t => isTrustedReceiptUrl(t.receiptUrl))
            .map(t => ({
                id: t.id,
                title: t.title,
                amount: t.amount,
                category: t.category,
                receiptUrl: t.receiptUrl!,
                date: t.date.toISOString(),
                payer: t.payer,
            }));

        return NextResponse.json({ receipts, members });
    } catch (error) {
        logger.error('Failed to fetch receipts', { err: error });
        return NextResponse.json({ error: 'Failed to fetch receipts' }, { status: 500 });
    }
}
