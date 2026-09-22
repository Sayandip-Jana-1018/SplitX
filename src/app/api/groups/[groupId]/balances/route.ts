import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { balanceOf, loadGroupLedger, planLedgerTransfers } from '@/lib/ledger';
import { logger } from '@/lib/logger';

// GET /api/groups/[groupId]/balances — a group's balances and settle-up plan.
// The same ledger as Settle Up (lib/ledger.ts), so the two can never disagree.
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
        const user = await prisma.user.findUnique({ where: { email: session.user.email } });

        if (!user) {
            return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }

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

        const ledger = await loadGroupLedger(groupId);
        if (!ledger || ledger.trips.length === 0) {
            return NextResponse.json({ members: [], balances: {}, settlements: [] });
        }

        // The page lists the latest expenses; it never needed all of them.
        const recent = await prisma.transaction.findMany({
            where: { tripId: { in: ledger.trips.map((trip) => trip.id) }, deletedAt: null },
            include: {
                payer: { select: { id: true, name: true, image: true } },
                splits: {
                    include: { user: { select: { id: true, name: true, image: true } } },
                },
                trip: {
                    select: { id: true, title: true },
                },
            },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: 20,
        });

        return NextResponse.json({
            members: ledger.members.map((member) => ({
                id: member.id,
                name: member.name,
                image: member.image,
                role: member.role,
                balance: balanceOf(ledger, member.id),
            })),
            balances: ledger.balances,
            settlements: planLedgerTransfers(ledger),
            transactions: recent,
            totalSpent: ledger.transactions.reduce((sum, transaction) => sum + transaction.amount, 0),
        });
    } catch (error) {
        logger.error('Failed to compute group balances', { err: error });
        return NextResponse.json({ error: 'Failed to fetch balances' }, { status: 500 });
    }
}
