import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/db';

/**
 * A group's invite link, /join/<inviteCode>, works for 7 days after its code is
 * made (D-112). Then anyone in the group can make a new one; while it still
 * works, only the group's owner or an admin can replace it, since that ends the
 * link for everyone it was sent to. Removing a member replaces it too, so they
 * can't walk back in with the old one.
 */
const INVITE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

/** When a link whose code was made at `issuedAt` stops working. */
export function inviteExpiresAt(issuedAt: Date) {
    return new Date(issuedAt.getTime() + INVITE_LIFETIME_MS);
}

export function inviteIsLive(issuedAt: Date, now = new Date()) {
    return now < inviteExpiresAt(issuedAt);
}

/** 32 random hex characters: nobody guesses one, and it fits a URL as it is. */
export function newInviteCode() {
    return randomUUID().replace(/-/g, '');
}

/**
 * Gives the group a new code, unless someone else replaced `currentCode` first,
 * and returns the code the group then has. Two people making a new link at the
 * same moment end up sharing one, instead of the second ending the first's.
 * `replaced` says whether this call was the one that changed it.
 */
export async function replaceInviteCode(groupId: string, currentCode: string) {
    const { count } = await prisma.group.updateMany({
        where: { id: groupId, inviteCode: currentCode },
        data: { inviteCode: newInviteCode(), inviteCodeIssuedAt: new Date() },
    });
    const group = await prisma.group.findUniqueOrThrow({
        where: { id: groupId },
        select: { inviteCode: true, inviteCodeIssuedAt: true },
    });
    return { ...group, replaced: count === 1 };
}
