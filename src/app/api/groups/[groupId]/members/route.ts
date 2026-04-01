import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { createAuditLog } from '@/lib/auditLog';

// DELETE /api/groups/:groupId/members — remove a member from the group
export async function DELETE(
    req: Request,
    { params }: { params: Promise<{ groupId: string }> }
) {
    try {
        const session = await auth();
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { groupId } = await params;
        const { userId } = await req.json();

        if (!userId) {
            return NextResponse.json({ error: 'userId is required' }, { status: 400 });
        }

        const currentUser = await prisma.user.findUnique({ where: { email: session.user.email } });
        if (!currentUser) return NextResponse.json({ error: 'User not found' }, { status: 404 });

        // Verify the group exists and the current user is the owner or admin
        const group = await prisma.group.findFirst({
            where: { id: groupId, deletedAt: null },
            include: {
                members: true,
                trips: { select: { id: true } },
            },
        });

        if (!group) {
            return NextResponse.json({ error: 'Group not found' }, { status: 404 });
        }

        const isOwner = group.ownerId === currentUser.id;
        const currentMember = group.members.find(m => m.userId === currentUser.id);
        const isAdmin = currentMember?.role === 'admin';

        if (!isOwner && !isAdmin) {
            return NextResponse.json({ error: 'Only the group owner or admin can remove members' }, { status: 403 });
        }

        // Cannot remove the owner
        if (userId === group.ownerId) {
            return NextResponse.json({ error: 'Cannot remove the group owner' }, { status: 400 });
        }

        // Cannot remove yourself (use leave instead)
        if (userId === currentUser.id) {
            return NextResponse.json({ error: 'Cannot remove yourself' }, { status: 400 });
        }

        // Check if the member exists
        const targetMember = group.members.find(m => m.userId === userId);
        if (!targetMember) {
            return NextResponse.json({ error: 'User is not a member of this group' }, { status: 404 });
        }

        const tripIds = group.trips.map(t => t.id);

        // ── Recalculate splits within a DB transaction ──
        await prisma.$transaction(async (tx) => {
            // 1. Delete the membership
            await tx.groupMember.deleteMany({
                where: { groupId, userId },
            });

            // 2. Find all transactions where removed member has splits
            if (tripIds.length > 0) {
                const affectedTxns = await tx.transaction.findMany({
                    where: {
                        tripId: { in: tripIds },
                        deletedAt: null,
                        splits: { some: { userId } },
                    },
                    include: { splits: true },
                });

                for (const txn of affectedTxns) {
                    const memberSplit = txn.splits.find(s => s.userId === userId);
                    if (!memberSplit) continue;

                    // Delete the removed member's split
                    await tx.splitItem.delete({ where: { id: memberSplit.id } });

                    // For equal splits: redistribute total evenly among remaining members
                    if (txn.splitType === 'equal') {
                        const remainingSplits = txn.splits.filter(s => s.userId !== userId);
                        if (remainingSplits.length > 0) {
                            const perPerson = Math.floor(txn.amount / remainingSplits.length);
                            const remainder = txn.amount - perPerson * remainingSplits.length;

                            for (let i = 0; i < remainingSplits.length; i++) {
                                await tx.splitItem.update({
                                    where: { id: remainingSplits[i].id },
                                    data: { amount: perPerson + (i === 0 ? remainder : 0) },
                                });
                            }
                        }
                    } else {
                        // For custom/percentage splits: redistribute removed member's share proportionally
                        const remainingSplits = txn.splits.filter(s => s.userId !== userId);
                        const removedAmount = memberSplit.amount;
                        const remainingTotal = remainingSplits.reduce((sum, s) => sum + s.amount, 0);

                        if (remainingSplits.length > 0 && removedAmount > 0) {
                            let distributed = 0;
                            for (let i = 0; i < remainingSplits.length; i++) {
                                const isLast = i === remainingSplits.length - 1;
                                const share = isLast
                                    ? removedAmount - distributed
                                    : Math.round((remainingSplits[i].amount / (remainingTotal || 1)) * removedAmount);
                                distributed += share;
                                await tx.splitItem.update({
                                    where: { id: remainingSplits[i].id },
                                    data: { amount: remainingSplits[i].amount + share },
                                });
                            }
                        }
                    }
                }
            }
        });

        // ── Get removed user details ──
        const removedUser = await prisma.user.findUnique({
            where: { id: userId },
            select: { name: true },
        });
        const removedName = removedUser?.name || 'A member';

        await createAuditLog({
            userId: currentUser.id,
            action: 'delete',
            entityType: 'group_member',
            entityId: `${groupId}:${userId}`,
            details: {
                groupId,
                removedUserId: userId,
                removedUserName: removedName,
                byUserId: currentUser.id,
            },
        });

        // ── Notify the removed user ──
        try {
            await prisma.notification.deleteMany({
                where: {
                    userId,
                    OR: [
                        { link: `/groups/${groupId}` },
                        { link: { startsWith: `/groups/${groupId}/` } },
                    ],
                },
            });

            await prisma.notification.create({
                data: {
                    user: { connect: { id: userId } },
                    actor: { connect: { id: currentUser.id } },
                    type: 'member_removed',
                    title: '🚪 Removed from group',
                    body: `You were removed from "${group.name}" by ${currentUser.name || 'an admin'}. Splits have been recalculated.`,
                    link: '/groups',
                },
            });
        } catch {
            // non-fatal
        }

        // ── Notify remaining members ──
        try {
            const remainingMemberIds = group.members
                .map(m => m.userId)
                .filter(id => id !== userId && id !== currentUser.id);

            if (remainingMemberIds.length > 0) {
                await prisma.notification.createMany({
                    data: remainingMemberIds.map(memberId => ({
                        userId: memberId,
                        actorId: currentUser.id,
                        type: 'group_activity',
                        title: '🚪 Member removed',
                        body: `${removedName} was removed from "${group.name}" by ${currentUser.name || 'an admin'}. Equal splits have been recalculated.`,
                        link: `/groups/${groupId}`,
                    })),
                });
            }
        } catch {
            // non-fatal
        }

        return NextResponse.json({
            success: true,
            message: `${removedName} removed and splits recalculated`,
        });
    } catch (error) {
        console.error('Remove member error:', error);
        return NextResponse.json({ error: 'Failed to remove member' }, { status: 500 });
    }
}
