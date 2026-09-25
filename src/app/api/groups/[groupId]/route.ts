import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { createAuditLog } from '@/lib/auditLog';
import { computeGroupBalances } from '@/lib/groupFinance';
import { isLedgerSettled, loadGroupLedger } from '@/lib/ledger';
import { inviteExpiresAt, inviteIsLive } from '@/lib/groupInvite';
import { formatCurrency } from '@/lib/utils';
import { logger } from '@/lib/logger';

class DeletionRefused extends Error {
    constructor(message: string, readonly status: number) {
        super(message);
    }
}

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

        // A group is deleted only once everyone is square: deleting it used to
        // wipe out what members still owed each other, and cancel payments on
        // their way. The check and the delete share one serializable
        // transaction, so an expense saved at the same moment can't slip past.
        try {
            await prisma.$transaction(async (tx) => {
                const ledger = await loadGroupLedger(groupId, tx);
                if (!ledger) throw new DeletionRefused('Group not found', 404);
                if (!isLedgerSettled(ledger)) {
                    const open = Object.values(ledger.balances).filter((amount) => amount !== 0).length;
                    const outstanding = Object.values(ledger.balances).reduce((sum, amount) => sum + Math.max(0, amount), 0);
                    throw new DeletionRefused(
                        outstanding > 0
                            ? `${open} people still owe or are owed ${formatCurrency(outstanding)} in this group. Settle up first, then delete it.`
                            : 'Some payments in this group are still waiting. Complete or cancel them first, then delete it.',
                        409
                    );
                }

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
                }

                await tx.notification.deleteMany({
                    where: {
                        OR: [
                            { link: `/groups/${groupId}` },
                            { link: { startsWith: `/groups/${groupId}/` } },
                        ],
                    },
                });
            }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        } catch (error) {
            if (error instanceof DeletionRefused) {
                return NextResponse.json({ error: error.message }, { status: error.status });
            }
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
                return NextResponse.json(
                    { error: 'The group changed while deleting it. Please try again.' },
                    { status: 409 }
                );
            }
            throw error;
        }

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
                        body: `${user.name || 'The owner'} deleted the group "${group.name}". Everyone was settled up.`,
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
        logger.error('Group delete error', { err: error });
        return NextResponse.json({ error: 'Failed to delete group' }, { status: 500 });
    }
}
