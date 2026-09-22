import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { createAuditLog } from '@/lib/auditLog';
import { balanceOf, loadGroupLedger, pendingSettlementsOf } from '@/lib/ledger';
import { logger } from '@/lib/logger';

const RemoveMemberSchema = z.object({ userId: z.string().min(1).max(64) });

const rupees = (paise: number) => `₹${(Math.abs(paise) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

class RemovalRefused extends Error {
    constructor(message: string, readonly status: number) {
        super(message);
    }
}

// DELETE /api/groups/:groupId/members — remove a member from the group.
//
// A member can leave only once they are square with the group: no balance and
// no settlement still open. Their expenses and shares stay exactly as they
// were. This used to rewrite everyone's shares, ignoring what the removed
// member had paid or already settled, so the rest of the group ended up owing
// someone who was no longer in it (D-063).
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
        const parsed = RemoveMemberSchema.safeParse(await req.json().catch(() => null));
        if (!parsed.success) {
            return NextResponse.json({ error: 'userId is required' }, { status: 400 });
        }
        const { userId } = parsed.data;

        const currentUser = await prisma.user.findUnique({ where: { email: session.user.email } });
        if (!currentUser) return NextResponse.json({ error: 'User not found' }, { status: 404 });

        const group = await prisma.group.findFirst({
            where: { id: groupId, deletedAt: null },
            include: { members: true },
        });

        if (!group) {
            return NextResponse.json({ error: 'Group not found' }, { status: 404 });
        }

        const isOwner = group.ownerId === currentUser.id;
        const currentMember = group.members.find((member) => member.userId === currentUser.id);
        const isAdmin = currentMember?.role === 'admin';

        if (!isOwner && !isAdmin) {
            return NextResponse.json({ error: 'Only the group owner or admin can remove members' }, { status: 403 });
        }
        if (userId === group.ownerId) {
            return NextResponse.json({ error: 'Cannot remove the group owner' }, { status: 400 });
        }
        if (userId === currentUser.id) {
            return NextResponse.json({ error: 'Cannot remove yourself' }, { status: 400 });
        }
        if (!group.members.some((member) => member.userId === userId)) {
            return NextResponse.json({ error: 'User is not a member of this group' }, { status: 404 });
        }

        // The check and the removal happen in one serializable transaction: an
        // expense saved at the same moment makes one of the two fail rather than
        // leave a debt behind with someone who is no longer a member.
        let removedName = 'A member';
        try {
            await prisma.$transaction(async (tx) => {
                const ledger = await loadGroupLedger(groupId, tx);
                if (!ledger) throw new RemovalRefused('Group not found', 404);

                const person = ledger.people.get(userId);
                removedName = person?.name || removedName;

                const balance = balanceOf(ledger, userId);
                if (balance !== 0) {
                    const owes = balance < 0;
                    throw new RemovalRefused(
                        `${removedName} ${owes ? 'still owes' : 'is still owed'} ${rupees(balance)} in this group. `
                        + 'Settle up first, then remove them.',
                        409
                    );
                }
                const open = pendingSettlementsOf(ledger, userId);
                if (open.length > 0) {
                    throw new RemovalRefused(
                        `${removedName} has ${open.length} settlement${open.length === 1 ? '' : 's'} still waiting. `
                        + 'Complete or cancel them first.',
                        409
                    );
                }

                await tx.groupMember.deleteMany({ where: { groupId, userId } });
                // A removed member must not be able to walk back in with the old link.
                await tx.group.update({ where: { id: groupId }, data: { inviteCode: randomUUID().replace(/-/g, '') } });
            }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        } catch (error) {
            if (error instanceof RemovalRefused) {
                return NextResponse.json({ error: error.message }, { status: error.status });
            }
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
                return NextResponse.json(
                    { error: 'The group changed while removing this member. Please try again.' },
                    { status: 409 }
                );
            }
            throw error;
        }

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
                    body: `You were removed from "${group.name}" by ${currentUser.name || 'an admin'}. You were all settled up.`,
                    link: '/groups',
                },
            });
        } catch {
            // non-fatal
        }

        // ── Notify remaining members ──
        try {
            const remainingMemberIds = group.members
                .map((member) => member.userId)
                .filter((id) => id !== userId && id !== currentUser.id);

            if (remainingMemberIds.length > 0) {
                await prisma.notification.createMany({
                    data: remainingMemberIds.map((memberId) => ({
                        userId: memberId,
                        actorId: currentUser.id,
                        type: 'group_activity',
                        title: '🚪 Member removed',
                        body: `${removedName} was removed from "${group.name}" by ${currentUser.name || 'an admin'}. Their past expenses stay in the history.`,
                        link: `/groups/${groupId}`,
                    })),
                });
            }
        } catch {
            // non-fatal
        }

        return NextResponse.json({
            success: true,
            message: `${removedName} was removed from the group`,
        });
    } catch (error) {
        logger.error('Remove member error', { err: error });
        return NextResponse.json({ error: 'Failed to remove member' }, { status: 500 });
    }
}
