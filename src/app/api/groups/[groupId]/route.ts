import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { createAuditLog } from '@/lib/auditLog';

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

        // Compute member balances from all trips
        const balances: Record<string, number> = {};
        for (const member of group.members) {
            balances[member.userId] = 0;
        }

        for (const trip of group.trips) {
            for (const txn of trip.transactions) {
                balances[txn.payerId] = (balances[txn.payerId] || 0) + txn.amount;
                for (const split of txn.splits) {
                    balances[split.userId] = (balances[split.userId] || 0) - split.amount;
                }
            }
            // Account for completed/confirmed settlements
            for (const s of trip.settlements) {
                if ((s.status === 'completed' || s.status === 'confirmed') && !s.deletedAt) {
                    balances[s.fromId] = (balances[s.fromId] || 0) + s.amount;
                    balances[s.toId] = (balances[s.toId] || 0) - s.amount;
                }
            }
        }

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
            totalSpent,
            activeTrip,
            balances,
            currentUserId: user.id,
        });
    } catch (error) {
        console.error('Group detail error:', error);
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

        // Fetch group — only owner can delete
        const group = await prisma.group.findFirst({
            where: { id: groupId, deletedAt: null },
            include: {
                members: { include: { user: { select: { id: true, name: true } } } },
                trips: { select: { id: true } },
            },
        });

        if (!group) {
            return NextResponse.json({ error: 'Group not found' }, { status: 404 });
        }

        if (group.ownerId !== user.id) {
            return NextResponse.json(
                { error: 'Only the group owner can delete this group' },
                { status: 403 }
            );
        }

        const tripIds = group.trips.map(t => t.id);

        // Use a DB transaction for atomic cascade
        await prisma.$transaction(async (tx) => {
            // 1. Soft-delete the group
            await tx.group.update({
                where: { id: groupId },
                data: { deletedAt: new Date() },
            });

            // 2. Soft-delete all transactions in group trips
            if (tripIds.length > 0) {
                await tx.transaction.updateMany({
                    where: { tripId: { in: tripIds }, deletedAt: null },
                    data: { deletedAt: new Date() },
                });

                // 3. Cancel all pending/initiated settlements
                await tx.settlement.updateMany({
                    where: {
                        tripId: { in: tripIds },
                        status: { in: ['pending', 'initiated'] },
                        deletedAt: null,
                    },
                    data: { status: 'cancelled', deletedAt: new Date() },
                });
            }
        });

        await createAuditLog({
            userId: user.id,
            action: 'delete',
            entityType: 'group',
            entityId: group.id,
            details: {
                groupId: group.id,
                name: group.name,
                memberCount: group.members.length,
                tripIds,
            },
        });

        // 4. Notify all members (non-blocking)
        try {
            const otherMemberIds = group.members
                .map(m => m.userId)
                .filter(id => id !== user.id);

            if (otherMemberIds.length > 0) {
                await prisma.notification.createMany({
                    data: otherMemberIds.map(memberId => ({
                        userId: memberId,
                        actorId: user.id,
                        type: 'group_activity',
                        title: '🗑️ Group deleted',
                        body: `${user.name || 'The owner'} deleted the group "${group.name}". All pending settlements have been cancelled.`,
                        link: '/groups',
                    })),
                });
            }
        } catch {
            // Notification failure shouldn't block the deletion
        }

        return NextResponse.json({
            message: 'Group deleted successfully',
            groupId,
            groupName: group.name,
        });
    } catch (error) {
        console.error('Group delete error:', error);
        return NextResponse.json({ error: 'Failed to delete group' }, { status: 500 });
    }
}
