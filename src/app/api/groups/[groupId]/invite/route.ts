import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { createAuditLog } from '@/lib/auditLog';
import { inviteExpiresAt, inviteIsLive, replaceInviteCode } from '@/lib/groupInvite';

// POST /api/groups/:groupId/invite — a link that works (D-112). The owner or an
// admin always gets a new one, which ends the old one. Anyone else in the group
// renews an expired link, and is given back one that still works.
export async function POST(
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
                OR: [{ ownerId: user.id }, { members: { some: { userId: user.id } } }],
            },
            select: {
                id: true,
                ownerId: true,
                inviteCode: true,
                inviteCodeIssuedAt: true,
                members: { where: { userId: user.id }, select: { role: true } },
            },
        });
        if (!group) return NextResponse.json({ error: 'Group not found' }, { status: 404 });

        // A link that still works may be in many people's messages: only the
        // owner or an admin ends it. A member who asks as someone else renews it
        // (two taps on "Make a new link") gets the one that now works.
        const isAdmin = group.ownerId === user.id || group.members.some((member) => member.role === 'admin');
        if (inviteIsLive(group.inviteCodeIssuedAt) && !isAdmin) {
            return NextResponse.json({
                inviteCode: group.inviteCode,
                inviteExpiresAt: inviteExpiresAt(group.inviteCodeIssuedAt),
            });
        }

        const current = await replaceInviteCode(group.id, group.inviteCode);
        if (current.replaced) {
            await createAuditLog({
                userId: user.id,
                action: 'update',
                entityType: 'group',
                entityId: group.id,
                details: { change: 'invite_link', byUserId: user.id },
            });
        }

        return NextResponse.json({
            inviteCode: current.inviteCode,
            inviteExpiresAt: inviteExpiresAt(current.inviteCodeIssuedAt),
        });
    } catch (error) {
        logger.error('Invite link error', { err: error });
        return NextResponse.json({ error: 'Could not make a new link' }, { status: 500 });
    }
}
