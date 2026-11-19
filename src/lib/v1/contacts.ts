import { prisma } from '@/lib/db';
import type { Contact, Invitation } from '@/lib/contract/v1';
import type { listContacts, pendingInvitations } from '@/lib/services/contacts';

/** The phone's view of contacts and invitations (src/lib/services/contacts.ts holds the rules). */

export function contactOf(contact: Awaited<ReturnType<typeof listContacts>>[number]): Contact {
    return {
        id: contact.id,
        name: contact.name,
        email: contact.email,
        phone: contact.phone,
        userId: contact.linkedUser?.id ?? null,
        image: contact.linkedUser?.image ?? null,
    };
}

export function invitationOf(invitation: Awaited<ReturnType<typeof pendingInvitations>>[number]): Invitation {
    return {
        id: invitation.id,
        groupId: invitation.group.id,
        groupName: invitation.group.name,
        groupEmoji: invitation.group.emoji,
        fromName: invitation.inviter.name || 'Someone',
        createdAt: invitation.createdAt.toISOString(),
    };
}

/** Who is asking, by name, for the messages the others get. */
export function actorOf(userId: string) {
    return prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true } });
}
