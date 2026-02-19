import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { createNotification } from '@/lib/notifications';
import { z } from 'zod';

const ActionSchema = z.object({
    status: z.enum(['accepted', 'declined']),
});

/**
 * PATCH /api/invitations/[id] — accept or decline an invitation
 */
export async function PATCH(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const session = await auth();
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const user = await prisma.user.findUnique({ where: { email: session.user.email } });
        if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

        const { id } = await params;

        const body = await req.json();
        const parsed = ActionSchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json({ error: 'status must be "accepted" or "declined"' }, { status: 400 });
        }

        // Find the invitation
        const invitation = await prisma.groupInvitation.findUnique({
            where: { id },
            include: {
                group: { select: { id: true, name: true, emoji: true } },
                inviter: { select: { id: true, name: true } },
            },
        });

        if (!invitation) {
            return NextResponse.json({ error: 'Invitation not found' }, { status: 404 });
        }

        // Only the invitee can respond
        if (invitation.inviteeId !== user.id) {
            return NextResponse.json({ error: 'Not your invitation' }, { status: 403 });
        }

        if (invitation.status !== 'pending') {
            return NextResponse.json({ error: 'Invitation already responded to' }, { status: 409 });
        }

        const newStatus = parsed.data.status;

        // Update invitation status
        await prisma.groupInvitation.update({
            where: { id },
            data: { status: newStatus },
        });

        if (newStatus === 'accepted') {
            // Add user to the group
            await prisma.groupMember.create({
                data: {
                    groupId: invitation.groupId,
                    userId: user.id,
                    role: 'member',
                },
            });

            // Notify the inviter
            await createNotification({
                userId: invitation.inviterId,
                type: 'group_invite_accepted',
                title: 'Invitation Accepted!',
                body: `${user.name || 'Someone'} accepted your invite to ${invitation.group.emoji} ${invitation.group.name}`,
                link: `/groups/${invitation.groupId}`,
            });
        } else {
            // Notify the inviter about decline
            await createNotification({
                userId: invitation.inviterId,
                type: 'group_activity',
                title: 'Invitation Declined',
                body: `${user.name || 'Someone'} declined your invite to ${invitation.group.emoji} ${invitation.group.name}`,
                link: `/groups/${invitation.groupId}`,
            });
        }

        return NextResponse.json({
            success: true,
            status: newStatus,
            groupId: newStatus === 'accepted' ? invitation.groupId : undefined,
        });
    } catch (error) {
        console.error('Invitation action error:', error);
        return NextResponse.json({ error: 'Failed to process invitation' }, { status: 500 });
    }
}
