import { prisma } from '@/lib/db';
import { inviteIsLive, replaceInviteCode } from '@/lib/groupInvite';
import { createNotification } from '@/lib/notifications';

/**
 * Your contacts, and inviting people into groups, for the website (/api/contacts,
 * /api/invitations) and the phone app (/api/v1/contacts, /api/v1/invitations) alike: one copy
 * of the rules (docs/mobile/ROADMAP.md, Phase 4 step 4).
 */

export type ContactOutcome<T> = { ok: true; value: T } | { ok: false; status: number; error: string; code: string };

const LINKED = { linkedUser: { select: { id: true, name: true, image: true, email: true } } } as const;

/** Your contacts, newest first, each with the account its email belongs to, if any. */
export function listContacts(userId: string) {
    return prisma.contact.findMany({ where: { ownerId: userId }, include: LINKED, orderBy: { addedAt: 'desc' } });
}

/**
 * Adds a contact by name and email (and a phone number, if given). An email you already have is
 * refused; one that belongs to an account is linked to it, so they can be invited into a group.
 */
export async function addContact(userId: string, input: { name: string; email: string; phone?: string | null }) {
    const existing = await prisma.contact.findUnique({ where: { ownerId_email: { ownerId: userId, email: input.email } } });
    if (existing) return { ok: false, status: 409, error: 'Contact already exists', code: 'exists' } as const;
    const linkedUser = await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } });
    const contact = await prisma.contact.create({
        data: { ownerId: userId, name: input.name, email: input.email, phone: input.phone || null, linkedUserId: linkedUser?.id || null },
        include: LINKED,
    });
    return { ok: true, value: contact } as const;
}

/** Removes one of your contacts; anyone else's is not found. */
export async function removeContact(userId: string, contactId: string): Promise<ContactOutcome<null>> {
    const contact = await prisma.contact.findFirst({ where: { id: contactId, ownerId: userId } });
    if (!contact) return { ok: false, status: 404, error: 'Contact not found', code: 'not_found' };
    await prisma.contact.delete({ where: { id: contactId } });
    return { ok: true, value: null };
}

/**
 * A link and a message to send a contact yourself (share sheet, WhatsApp, email): to sign up, or
 * to join one of your groups. A group's link goes only to its own members, since anyone holding
 * the code can join, and is never an expired one (src/lib/groupInvite.ts).
 */
export async function contactInvite(userId: string, contactId: string, groupId: string | undefined, site: string): Promise<ContactOutcome<{ url: string; message: string; name: string; email: string }>> {
    const contact = await prisma.contact.findFirst({ where: { id: contactId, ownerId: userId } });
    if (!contact) return { ok: false, status: 404, error: 'Contact not found', code: 'not_found' };
    let url = `${site}/register`;
    if (groupId) {
        const group = await prisma.group.findFirst({
            where: { id: groupId, deletedAt: null, OR: [{ ownerId: userId }, { members: { some: { userId } } }] },
            select: { id: true, inviteCode: true, inviteCodeIssuedAt: true },
        });
        if (!group) return { ok: false, status: 404, error: 'Group not found', code: 'not_found' };
        const { inviteCode } = inviteIsLive(group.inviteCodeIssuedAt) ? group : await replaceInviteCode(group.id, group.inviteCode);
        url = `${site}/join/${inviteCode}`;
    }
    return { ok: true, value: { url, message: `Hey ${contact.name}! Join me on SplitIT to split expenses easily. Click here: ${url}`, name: contact.name, email: contact.email } };
}

// ── Invitations into a group ───────────────────────────────

/**
 * Invites someone with an account into a group you're in: they are told, and accept or decline.
 * Not someone already in it, and not twice while one is waiting.
 */
export async function inviteToGroup(actor: { id: string; name: string | null }, groupId: string, inviteeId: string): Promise<ContactOutcome<{ id: string; status: string }>> {
    const membership = await prisma.groupMember.findFirst({ where: { groupId, userId: actor.id, group: { deletedAt: null } } });
    if (!membership) return { ok: false, status: 403, error: 'You are not a member of this group', code: 'not_member' };
    const invitee = await prisma.user.findUnique({ where: { id: inviteeId }, select: { id: true, name: true } });
    if (!invitee) return { ok: false, status: 404, error: 'User not found', code: 'not_found' };
    const existingMembership = await prisma.groupMember.findUnique({ where: { groupId_userId: { groupId, userId: inviteeId } } });
    if (existingMembership) return { ok: false, status: 409, error: 'User is already a member of this group', code: 'already_member' };
    const existingInvite = await prisma.groupInvitation.findUnique({ where: { groupId_inviteeId: { groupId, inviteeId } } });
    if (existingInvite && existingInvite.status === 'pending') return { ok: false, status: 409, error: 'Invitation already sent', code: 'already_invited' };
    const group = await prisma.group.findUnique({ where: { id: groupId }, select: { id: true, name: true, emoji: true } });
    if (!group) return { ok: false, status: 404, error: 'Group not found', code: 'not_found' };

    // A declined one is asked again.
    const invitation = await prisma.groupInvitation.upsert({
        where: { groupId_inviteeId: { groupId, inviteeId } },
        create: { groupId, inviterId: actor.id, inviteeId, status: 'pending' },
        update: { inviterId: actor.id, status: 'pending' },
    });
    await createNotification({
        userId: inviteeId,
        type: 'group_invite',
        title: 'Group Invitation',
        body: `${actor.name || 'Someone'} invited you to join ${group.emoji} ${group.name}`,
        link: `/invitations/${invitation.id}`,
    });
    return { ok: true, value: { id: invitation.id, status: invitation.status } };
}

/** Invitations waiting for your answer, newest first (to groups that still exist). */
export function pendingInvitations(userId: string) {
    return prisma.groupInvitation.findMany({
        where: { inviteeId: userId, status: 'pending', group: { deletedAt: null } },
        include: {
            group: { select: { id: true, name: true, emoji: true } },
            inviter: { select: { id: true, name: true, image: true } },
        },
        orderBy: { createdAt: 'desc' },
    });
}

/**
 * Your answer to an invitation: accepting puts you in the group. Only yours to answer; answered
 * already, it says how. The one who asked is told either way.
 */
export async function answerInvitation(user: { id: string; name: string | null }, invitationId: string, answer: 'accepted' | 'declined'): Promise<ContactOutcome<{ status: string; groupId?: string }>> {
    const invitation = await prisma.groupInvitation.findUnique({
        where: { id: invitationId },
        include: { group: { select: { id: true, name: true, emoji: true, deletedAt: true } }, inviter: { select: { id: true, name: true } } },
    });
    if (!invitation) return { ok: false, status: 404, error: 'Invitation not found', code: 'not_found' };
    if (invitation.inviteeId !== user.id) return { ok: false, status: 403, error: 'Not your invitation', code: 'not_yours' };
    if (invitation.status !== 'pending') {
        return { ok: true, value: { status: invitation.status, groupId: invitation.status === 'accepted' ? invitation.groupId : undefined } };
    }
    // A group deleted since can't be joined.
    if (answer === 'accepted' && invitation.group.deletedAt) return { ok: false, status: 404, error: 'That group was deleted', code: 'group_deleted' };

    await prisma.groupInvitation.update({ where: { id: invitationId }, data: { status: answer } });
    if (answer === 'accepted') {
        await prisma.groupMember.upsert({
            where: { groupId_userId: { groupId: invitation.groupId, userId: user.id } },
            create: { groupId: invitation.groupId, userId: user.id, role: 'member' },
            update: {},
        });
        await createNotification({
            userId: invitation.inviterId,
            type: 'group_invite_accepted',
            title: 'Invitation Accepted!',
            body: `${user.name || 'Someone'} accepted your invite to ${invitation.group.emoji} ${invitation.group.name}`,
            link: `/groups/${invitation.groupId}`,
        });
    } else {
        await createNotification({
            userId: invitation.inviterId,
            type: 'group_activity',
            title: 'Invitation Declined',
            body: `${user.name || 'Someone'} declined your invite to ${invitation.group.emoji} ${invitation.group.name}`,
            link: `/groups/${invitation.groupId}`,
        });
    }
    return { ok: true, value: { status: answer, groupId: answer === 'accepted' ? invitation.groupId : undefined } };
}
