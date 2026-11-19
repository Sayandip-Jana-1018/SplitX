import { Prisma } from '@prisma/client';
import { createAuditLog } from '@/lib/auditLog';
import { prisma } from '@/lib/db';
import { inviteExpiresAt, inviteIsLive, newInviteCode, replaceInviteCode } from '@/lib/groupInvite';
import { balanceOf, isLedgerSettled, loadGroupLedger, pendingSettlementsOf } from '@/lib/ledger';
import { pushToPhones } from '@/lib/notifications';
import { formatCurrency } from '@/lib/utils';

/**
 * Making, joining and inviting to a group, removing someone from it and
 * deleting it, for the website and the phone app alike (the website's
 * /api/groups routes and /api/v1). One copy of the rules.
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
        const rows = others.map((memberId) => ({
            userId: memberId,
            actorId: user.id,
            type: 'member_joined',
            title: 'New member joined',
            body: `${joinerName} joined "${group.name}"`,
            link: `/groups/${group.id}`,
        }));
        await prisma.notification.createMany({ data: rows });
        pushToPhones(rows);
    }
    return { ok: true, value: { groupId: group.id, joined: true } };
}

/**
 * What an invite code opens, before joining: the group's name, emoji and size.
 * An expired link shows nothing of the group, not even its name. `alreadyIn`
 * when `userId` is in it already.
 */
export async function previewInvite(inviteCode: string, userId?: string): Promise<GroupOutcome<{ groupId: string; name: string; emoji: string; members: number; alreadyIn: boolean }>> {
    const group = await prisma.group.findFirst({
        where: { inviteCode, deletedAt: null },
        select: { id: true, name: true, emoji: true, inviteCodeIssuedAt: true, _count: { select: { members: true } }, members: userId ? { where: { userId }, select: { userId: true } } : false },
    });
    if (!group) return { ok: false, status: 404, error: 'That link doesn’t match any group. Check it, or ask for a new one.', code: 'invalid_invite' };
    const alreadyIn = Array.isArray(group.members) && group.members.length > 0;
    if (!alreadyIn && !inviteIsLive(group.inviteCodeIssuedAt)) {
        return { ok: false, status: 410, error: 'This invite link has expired. Ask someone in the group for a new one.', code: 'invite_expired' };
    }
    return { ok: true, value: { groupId: group.id, name: group.name, emoji: group.emoji, members: group._count.members, alreadyIn } };
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

// ── Removing a member, deleting a group ─────────────────────

const rupees = (paise: number) => formatCurrency(Math.abs(paise));

class Refused extends Error {
    constructor(message: string, readonly status: number, readonly code: string) {
        super(message);
    }
}

/** Two writes at once on a serializable transaction: one is told to try again. */
const isRetry = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034';

/**
 * Removes `userId` from a group, as its owner or an admin: never the owner, never yourself, and
 * only someone square in it (no balance, no payment waiting), checked in the same serializable
 * transaction as the removal. The invite code changes, so an old link can't bring them back
 * unasked. They and the others are told.
 */
export async function removeMember(actor: { id: string; name: string | null }, groupId: string, userId: string): Promise<GroupOutcome<{ name: string }>> {
    const group = await prisma.group.findFirst({ where: { id: groupId, deletedAt: null }, include: { members: true } });
    if (!group) return { ok: false, status: 404, error: 'Group not found', code: 'not_found' };

    const isOwner = group.ownerId === actor.id;
    const isAdmin = group.members.find((member) => member.userId === actor.id)?.role === 'admin';
    if (!isOwner && !isAdmin) return { ok: false, status: 403, error: 'Only the group owner or admin can remove members', code: 'not_admin' };
    if (userId === group.ownerId) return { ok: false, status: 400, error: 'Cannot remove the group owner', code: 'owner' };
    if (userId === actor.id) return { ok: false, status: 400, error: 'Cannot remove yourself', code: 'yourself' };
    if (!group.members.some((member) => member.userId === userId)) return { ok: false, status: 404, error: 'User is not a member of this group', code: 'not_member' };

    let removedName = 'A member';
    try {
        await prisma.$transaction(async (tx) => {
            const ledger = await loadGroupLedger(groupId, tx);
            if (!ledger) throw new Refused('Group not found', 404, 'not_found');
            removedName = ledger.people.get(userId)?.name || removedName;
            const balance = balanceOf(ledger, userId);
            if (balance !== 0) {
                throw new Refused(`${removedName} ${balance < 0 ? 'still owes' : 'is still owed'} ${rupees(balance)} in this group. Settle up first, then remove them.`, 409, 'not_settled');
            }
            const open = pendingSettlementsOf(ledger, userId);
            if (open.length > 0) {
                throw new Refused(`${removedName} has ${open.length} settlement${open.length === 1 ? '' : 's'} still waiting. Complete or cancel them first.`, 409, 'payments_waiting');
            }
            await tx.groupMember.deleteMany({ where: { groupId, userId } });
            await tx.group.update({ where: { id: groupId }, data: { inviteCode: newInviteCode(), inviteCodeIssuedAt: new Date() } });
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
        if (error instanceof Refused) return { ok: false, status: error.status, error: error.message, code: error.code };
        if (isRetry(error)) return { ok: false, status: 409, error: 'The group changed while removing this member. Please try again.', code: 'retry' };
        throw error;
    }

    await createAuditLog({
        userId: actor.id,
        action: 'delete',
        entityType: 'group_member',
        entityId: `${groupId}:${userId}`,
        details: { groupId, removedUserId: userId, removedUserName: removedName, byUserId: actor.id },
    });

    try {
        await prisma.notification.deleteMany({
            where: { userId, OR: [{ link: `/groups/${groupId}` }, { link: { startsWith: `/groups/${groupId}/` } }] },
        });
        const removed = await prisma.notification.create({
            data: {
                user: { connect: { id: userId } },
                actor: { connect: { id: actor.id } },
                type: 'member_removed',
                title: '🚪 Removed from group',
                body: `You were removed from "${group.name}" by ${actor.name || 'an admin'}. You were all settled up.`,
                link: '/groups',
            },
        });
        pushToPhones([removed]);
    } catch {
        // non-fatal
    }

    try {
        const remainingMemberIds = group.members.map((member) => member.userId).filter((id) => id !== userId && id !== actor.id);
        if (remainingMemberIds.length > 0) {
            const rows = remainingMemberIds.map((memberId) => ({
                userId: memberId,
                actorId: actor.id,
                type: 'group_activity',
                title: '🚪 Member removed',
                body: `${removedName} was removed from "${group.name}" by ${actor.name || 'an admin'}. Their past expenses stay in the history.`,
                link: `/groups/${groupId}`,
            }));
            await prisma.notification.createMany({ data: rows });
            pushToPhones(rows);
        }
    } catch {
        // non-fatal
    }

    return { ok: true, value: { name: removedName } };
}

/**
 * Deletes a group, as its owner, once everyone in it is square: deleting it used to wipe out what
 * members still owed each other. The check and the delete share one serializable transaction, so
 * an expense saved at the same moment can't slip past. A soft delete, with its expenses; the
 * others are told.
 */
export async function deleteGroup(actor: { id: string; name: string | null }, groupId: string): Promise<GroupOutcome<{ groupId: string; name: string }>> {
    const group = await prisma.group.findFirst({
        where: { id: groupId, deletedAt: null },
        include: { members: { include: { user: { select: { id: true, name: true } } } }, trips: { select: { id: true } } },
    });
    if (!group) return { ok: false, status: 404, error: 'Group not found', code: 'not_found' };
    if (group.ownerId !== actor.id) return { ok: false, status: 403, error: 'Only the group owner can delete this group', code: 'not_owner' };

    const tripIds = group.trips.map((trip) => trip.id);
    try {
        await prisma.$transaction(async (tx) => {
            const ledger = await loadGroupLedger(groupId, tx);
            if (!ledger) throw new Refused('Group not found', 404, 'not_found');
            if (!isLedgerSettled(ledger)) {
                const open = Object.values(ledger.balances).filter((amount) => amount !== 0).length;
                const outstanding = Object.values(ledger.balances).reduce((sum, amount) => sum + Math.max(0, amount), 0);
                throw new Refused(
                    outstanding > 0
                        ? `${open} people still owe or are owed ${formatCurrency(outstanding)} in this group. Settle up first, then delete it.`
                        : 'Some payments in this group are still waiting. Complete or cancel them first, then delete it.',
                    409,
                    'not_settled',
                );
            }
            await tx.group.update({ where: { id: groupId }, data: { deletedAt: new Date() } });
            if (tripIds.length > 0) {
                await tx.transaction.updateMany({ where: { tripId: { in: tripIds }, deletedAt: null }, data: { deletedAt: new Date() } });
            }
            await tx.notification.deleteMany({
                where: { OR: [{ link: `/groups/${groupId}` }, { link: { startsWith: `/groups/${groupId}/` } }] },
            });
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
        if (error instanceof Refused) return { ok: false, status: error.status, error: error.message, code: error.code };
        if (isRetry(error)) return { ok: false, status: 409, error: 'The group changed while deleting it. Please try again.', code: 'retry' };
        throw error;
    }

    await createAuditLog({
        userId: actor.id,
        action: 'delete',
        entityType: 'group',
        entityId: group.id,
        details: { groupId: group.id, name: group.name, memberCount: group.members.length, tripIds },
    });

    try {
        const otherMemberIds = group.members.map((member) => member.userId).filter((id) => id !== actor.id);
        if (otherMemberIds.length > 0) {
            const rows = otherMemberIds.map((memberId) => ({
                userId: memberId,
                actorId: actor.id,
                type: 'group_activity',
                title: '🗑️ Group deleted',
                body: `${actor.name || 'The owner'} deleted the group "${group.name}". Everyone was settled up.`,
                link: '/groups',
            }));
            await prisma.notification.createMany({ data: rows });
            pushToPhones(rows);
        }
    } catch {
        // Notification failure shouldn't block the deletion
    }

    return { ok: true, value: { groupId, name: group.name } };
}
