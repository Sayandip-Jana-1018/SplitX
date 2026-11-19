import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { computeGroupBalances } from '@/lib/groupFinance';
import { inviteExpiresAt, inviteIsLive } from '@/lib/groupInvite';
import { logger } from '@/lib/logger';
import { deleteGroup } from '@/lib/services/groups';

// GET /api/groups/:groupId — full group detail
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
            include: {
                members: {
                    include: {
                        user: { select: { id: true, name: true, email: true, image: true } },
                    },
                },
                trips: {
                    orderBy: { createdAt: 'desc' },
                    include: {
                        transactions: {
                            where: { deletedAt: null },
                            include: {
                                payer: { select: { id: true, name: true } },
                                splits: { include: { user: { select: { id: true, name: true } } } },
                            },
                            orderBy: { createdAt: 'desc' },
                        },
                        settlements: {
                            include: {
                                from: { select: { id: true, name: true, image: true } },
                                to: { select: { id: true, name: true, image: true } },
                            },
                            orderBy: { createdAt: 'desc' },
                        },
                    },
                },
            },
        });

        if (!group) {
            return NextResponse.json({ error: 'Group not found' }, { status: 404 });
        }

        // Every trip's expenses and completed settlements, by the ledger's own
        // formula (lib/ledger.ts), so this page and Settle Up always agree.
        const balances = computeGroupBalances({
            memberIds: group.members.map((member) => member.userId),
            transactions: group.trips.flatMap((trip) => trip.transactions),
            settlements: group.trips.flatMap((trip) => trip.settlements),
        });

        // Compute total spent
        let totalSpent = 0;
        for (const trip of group.trips) {
            for (const txn of trip.transactions) {
                totalSpent += txn.amount;
            }
        }

        // Get the active trip (or most recent)
        const activeTrip = group.trips.find(t => t.isActive) || group.trips[0] || null;

        return NextResponse.json({
            ...group,
            // A link that no longer works is never handed out to be shared (D-112).
            inviteCode: inviteIsLive(group.inviteCodeIssuedAt) ? group.inviteCode : null,
            inviteExpiresAt: inviteExpiresAt(group.inviteCodeIssuedAt),
            totalSpent,
            activeTrip,
            balances,
            currentUserId: user.id,
        });
    } catch (error) {
        logger.error('Group detail error', { err: error });
        return NextResponse.json({ error: 'Failed to fetch group' }, { status: 500 });
    }
}

// DELETE /api/groups/:groupId — soft delete group (owner only) + cascade
export async function DELETE(
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
        if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

        // Only the owner, and only once everyone is square: the rules live in the shared
        // service (deleteGroup), which the phone app's DELETE /api/v1/groups/:groupId calls too.
        const outcome = await deleteGroup(user, groupId);
        if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
        return NextResponse.json({
            message: 'Group deleted successfully',
            groupId,
            groupName: outcome.value.name,
        });
    } catch (error) {
        logger.error('Group delete error', { err: error });
        return NextResponse.json({ error: 'Failed to delete group' }, { status: 500 });
    }
}
