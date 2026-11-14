import { Prisma } from '@prisma/client';
import { createAuditLog } from '@/lib/auditLog';
import { prisma } from '@/lib/db';
import { inviteExpiresAt, inviteIsLive, replaceInviteCode } from '@/lib/groupInvite';

/**
 * Making, joining and inviting to a group, for the website and the phone app
 * alike (the website's /api/groups routes and /api/v1). One copy of the rules.
 */

export type GroupOutcome<T> = { ok: true; value: T } | { ok: false; status: number; error: string; code: string };

/** A new group, with you as its admin and a first trip, so expenses can go in at once. */
export async function createGroup(userId: string, input: { name: string; emoji: string }) {
    const group = await prisma.group.create({
        data: {
            name: input.name,
            emoji: input.emoji,
            ownerId: userId,
            members: { create: { userId, role: 'admin' } },
            trips: { create: { title: input.name, isActive: true, currency: 'INR' } },
        },
    });
    await createAuditLog({
        userId,
        action: 'create',
        entityType: 'group',
        entityId: group.id,
        details: { groupId: group.id, name: group.name, emoji: group.emoji },
    });
    return group;
}

/**
 * Joins the group an invite code belongs to. A link works for 7 days
 * (lib/groupInvite.ts); someone already in the group is let through an old
 * one, since it opens nothing new.
 */
export async function joinGroup(user: { id: string; name: string | null; email: string | null }, inviteCode: string): Promise<GroupOutcome<{ groupId: string; joined: boolean }>> {
    const group = await prisma.group.findFirst({
        where: { inviteCode, deletedAt: null },
        include: { members: { select: { userId: true } } },
    });
    if (!group) return { ok: false, status: 404, error: 'Invalid invite code', code: 'invalid_invite' };

    const already = { ok: true as const, value: { groupId: group.id, joined: false } };
    if (group.members.some((member) => member.userId === user.id)) return already;
    if (!inviteIsLive(group.inviteCodeIssuedAt)) {
        return { ok: false, status: 410, error: 'This invite link has expired. Ask someone in the group for a new one.', code: 'invite_expired' };
    }

    // A second tap can pass the check above before the first one's insert
    // lands; the database's one-membership-per-person rule then refuses it,
    // and that tap is answered as what it is: already a member.
    try {
        await prisma.groupMember.create({ data: { groupId: group.id, userId: user.id, role: 'member' } });
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return already;
        throw error;
    }

    const others = group.members.map((member) => member.userId).filter((id) => id !== user.id);
    if (others.length > 0) {
        const joinerName = user.name || user.email?.split('@')[0] || 'Someone';
        await prisma.notification.createMany({
            data: others.map((memberId) => ({
                userId: memberId,
                actorId: user.id,
                type: 'member_joined',
                title: 'New member joined',
                body: `${joinerName} joined "${group.name}"`,
                link: `/groups/${group.id}`,
            })),
        });
    }
    return { ok: true, value: { groupId: group.id, joined: true } };
}

/**
 * A link that works (D-112), or null if the group doesn't exist or you aren't
 * in it. A link still working may be in many people's messages, so it is kept,
 * unless `adminMakesNew` and you are the owner or an admin: the website's
 * "Make a new link", which ends the old one. An expired link is always renewed.
 */
export async function inviteLink(userId: string, groupId: string, { adminMakesNew }: { adminMakesNew: boolean }) {
    const group = await prisma.group.findFirst({
        where: { id: groupId, deletedAt: null, OR: [{ ownerId: userId }, { members: { some: { userId } } }] },
        select: {
            id: true,
            ownerId: true,
            inviteCode: true,
            inviteCodeIssuedAt: true,
            members: { where: { userId }, select: { role: true } },
        },
    });
    if (!group) return null;

    const isAdmin = group.ownerId === userId || group.members.some((member) => member.role === 'admin');
    if (inviteIsLive(group.inviteCodeIssuedAt) && !(adminMakesNew && isAdmin)) {
        return { inviteCode: group.inviteCode, inviteExpiresAt: inviteExpiresAt(group.inviteCodeIssuedAt) };
    }

    const current = await replaceInviteCode(group.id, group.inviteCode);
    if (current.replaced) {
        await createAuditLog({
            userId,
            action: 'update',
            entityType: 'group',
            entityId: group.id,
            details: { change: 'invite_link', byUserId: userId },
        });
    }
    return { inviteCode: current.inviteCode, inviteExpiresAt: inviteExpiresAt(current.inviteCodeIssuedAt) };
}
