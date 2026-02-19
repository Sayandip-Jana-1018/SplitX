import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { createNotification } from '@/lib/notifications';
import { z } from 'zod';

const InviteSchema = z.object({
    groupId: z.string().min(1),
    inviteeId: z.string().min(1),
});

/**
 * POST /api/invitations — send a group invitation to a user
 */
export async function POST(req: Request) {
    try {
        const session = await auth();
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const user = await prisma.user.findUnique({ where: { email: session.user.email } });
        if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

        const body = await req.json();
        const parsed = InviteSchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json({ error: 'groupId and inviteeId are required' }, { status: 400 });
        }

        const { groupId, inviteeId } = parsed.data;

        // Check the inviter is a member of the group
        const membership = await prisma.groupMember.findUnique({
            where: { groupId_userId: { groupId, userId: user.id } },
        });
        if (!membership) {
            return NextResponse.json({ error: 'You are not a member of this group' }, { status: 403 });
        }

        // Check invitee exists
        const invitee = await prisma.user.findUnique({
            where: { id: inviteeId },
            select: { id: true, name: true },
        });
        if (!invitee) {
            return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }

        // Check invitee is not already a member
        const existingMembership = await prisma.groupMember.findUnique({
            where: { groupId_userId: { groupId, userId: inviteeId } },
        });
        if (existingMembership) {
            return NextResponse.json({ error: 'User is already a member of this group' }, { status: 409 });
        }

        // Check for existing pending invitation
        const existingInvite = await prisma.groupInvitation.findUnique({
            where: { groupId_inviteeId: { groupId, inviteeId } },
        });
        if (existingInvite && existingInvite.status === 'pending') {
            return NextResponse.json({ error: 'Invitation already sent' }, { status: 409 });
        }

        // Get group details for notification
        const group = await prisma.group.findUnique({
            where: { id: groupId },
            select: { id: true, name: true, emoji: true },
        });
        if (!group) {
            return NextResponse.json({ error: 'Group not found' }, { status: 404 });
        }

        // Upsert invitation (in case a declined one exists)
        const invitation = await prisma.groupInvitation.upsert({
            where: { groupId_inviteeId: { groupId, inviteeId } },
            create: { groupId, inviterId: user.id, inviteeId, status: 'pending' },
            update: { inviterId: user.id, status: 'pending' },
        });

        // Create notification for the invitee
        await createNotification({
            userId: inviteeId,
            type: 'group_invite',
            title: 'Group Invitation',
            body: `${user.name || 'Someone'} invited you to join ${group.emoji} ${group.name}`,
            link: `/api/invitations/${invitation.id}`,
        });

        return NextResponse.json({
            success: true,
            invitation: { id: invitation.id, status: invitation.status },
        }, { status: 201 });
    } catch (error) {
        console.error('Create invitation error:', error);
        return NextResponse.json({ error: 'Failed to send invitation' }, { status: 500 });
    }
}

/**
 * GET /api/invitations — list pending invitations for the current user
 */
export async function GET() {
    try {
        const session = await auth();
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const user = await prisma.user.findUnique({ where: { email: session.user.email } });
        if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

        const invitations = await prisma.groupInvitation.findMany({
            where: { inviteeId: user.id, status: 'pending' },
            include: {
                group: { select: { id: true, name: true, emoji: true } },
                inviter: { select: { id: true, name: true, image: true } },
            },
            orderBy: { createdAt: 'desc' },
        });

        return NextResponse.json(invitations);
    } catch (error) {
        console.error('List invitations error:', error);
        return NextResponse.json({ error: 'Failed to fetch invitations' }, { status: 500 });
    }
}
