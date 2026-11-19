import { prisma } from '@/lib/db';
import { withViewableReceipts } from '@/lib/receiptAccess';

/**
 * A group's receipt photos, for the people in it: the website's gallery
 * (GET /api/groups/:groupId/receipts) and the phone's (GET /api/v1/groups/:groupId/receipts).
 * Photos in the private bucket come back as signed links that work for an hour
 * (src/lib/receiptAccess.ts); any that can't be shown are left out. Null when
 * the group isn't there or you aren't in it.
 */
export async function groupReceipts(userId: string, groupId: string) {
    const groupAccess = await prisma.group.findFirst({
        where: {
            id: groupId,
            deletedAt: null,
            OR: [
                { ownerId: userId },
                { members: { some: { userId } } },
            ],
        },
        select: { id: true },
    });
    if (!groupAccess) return null;

    const trips = await prisma.trip.findMany({ where: { groupId }, select: { id: true } });
    if (trips.length === 0) return { receipts: [], members: [] };
    const tripIds = trips.map((trip) => trip.id);

    // Expenses with a receipt (not deleted), newest first.
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

    // The group's members, for the gallery's filter.
    const membersRaw = await prisma.groupMember.findMany({
        where: { groupId },
        include: { user: { select: { id: true, name: true, image: true } } },
    });
    const members = membersRaw.map((member) => ({
        id: member.user.id,
        name: member.user.name || 'Unknown',
        image: member.user.image,
    }));

    const receipts = (await withViewableReceipts(transactions))
        .filter((t): t is typeof t & { receiptUrl: string } => typeof t.receiptUrl === 'string')
        .map((t) => ({
            id: t.id,
            title: t.title,
            amount: t.amount,
            category: t.category,
            receiptUrl: t.receiptUrl,
            date: t.date.toISOString(),
            payer: t.payer,
        }));

    return { receipts, members };
}
