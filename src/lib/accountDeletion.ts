import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { balanceOf, loadGroupLedgers, pendingSettlementsOf } from '@/lib/ledger';
import { formatCurrency } from '@/lib/utils';

/** What the people and history an account leaves behind call it from now on. */
export const DELETED_USER_NAME = 'Deleted user';

export class DeletionRefused extends Error {
    constructor(message: string, readonly status = 409) {
        super(message);
    }
}

export interface DeletionOutcome {
    groupsLeft: number;
    groupsHandedOver: number;
    groupsClosed: number;
}

/**
 * Deletes an account without breaking anyone else's money history.
 *
 * Expenses, shares and payments belong to groups as much as to the person, so
 * they stay, and the person is erased from them instead: name, email, photo,
 * password, phone and UPI ID go, and the history shows "Deleted user". Every
 * group then still adds up to zero.
 *
 * - Refused while the person owes or is owed anything, or has a payment still
 *   open, in any group: leaving would strand that money (D-063).
 * - A group they own passes to its longest-standing admin, else its
 *   longest-standing member; a group nobody else is in is closed.
 * - They leave every group; everything personal is deleted: sign-in links
 *   (a later Google or GitHub sign-in makes a new account), contacts, budgets,
 *   AI chat, notifications, pending invitations and emailed links.
 * - Every session ends (tokenVersion), and the address is free to sign up again.
 *
 * One serializable transaction: nothing is half-deleted, and money moving at
 * the same moment makes it refuse instead of slipping past the check.
 */
export async function deleteAccount(userId: string): Promise<DeletionOutcome> {
    const run = async (tx: Prisma.TransactionClient): Promise<DeletionOutcome> => {
        const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true, email: true } });
        if (!user) throw new DeletionRefused('Account not found', 404);

        const groups = await tx.group.findMany({
            where: { deletedAt: null, OR: [{ ownerId: userId }, { members: { some: { userId } } }] },
            select: { id: true, ownerId: true },
        });
        const ledgers = await loadGroupLedgers(groups.map((group) => group.id), tx);

        const open = ledgers.flatMap((ledger) => {
            const balance = balanceOf(ledger, userId);
            if (balance < 0) return [`you owe ${formatCurrency(-balance)} in ${ledger.groupName}`];
            if (balance > 0) return [`you’re owed ${formatCurrency(balance)} in ${ledger.groupName}`];
            if (pendingSettlementsOf(ledger, userId).length > 0) return [`a payment is still open in ${ledger.groupName}`];
            return [];
        });
        if (open.length > 0) {
            throw new DeletionRefused(`Settle up first: ${open.join('; ')}. Then you can delete your account.`);
        }

        let groupsHandedOver = 0;
        let groupsClosed = 0;
        for (const group of groups.filter((candidate) => candidate.ownerId === userId)) {
            const others = await tx.groupMember.findMany({
                where: { groupId: group.id, userId: { not: userId } },
                orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
            });
            const successor = others.find((member) => member.role === 'admin') ?? others[0];
            if (successor) {
                await tx.group.update({ where: { id: group.id }, data: { ownerId: successor.userId } });
                await tx.groupMember.update({ where: { id: successor.id }, data: { role: 'admin' } });
                groupsHandedOver += 1;
            } else {
                await tx.group.update({ where: { id: group.id }, data: { deletedAt: new Date() } });
                groupsClosed += 1;
            }
        }

        await tx.groupMember.deleteMany({ where: { userId } });
        await tx.groupInvitation.deleteMany({ where: { status: 'pending', OR: [{ inviterId: userId }, { inviteeId: userId }] } });
        // Other people's address books keep the entry they typed, unlinked.
        await tx.contact.updateMany({ where: { linkedUserId: userId }, data: { linkedUserId: null } });
        await tx.contact.deleteMany({ where: { ownerId: userId } });
        await tx.budget.deleteMany({ where: { userId } });
        await tx.chatMessage.deleteMany({ where: { userId } });
        await tx.notification.deleteMany({ where: { userId } });
        await tx.account.deleteMany({ where: { userId } });
        await tx.session.deleteMany({ where: { userId } });
        if (user.email) {
            await tx.verificationToken.deleteMany({ where: { identifier: { equals: user.email, mode: 'insensitive' } } });
            await tx.passwordResetToken.deleteMany({ where: { email: { equals: user.email, mode: 'insensitive' } } });
        }

        await tx.user.update({
            where: { id: userId },
            data: {
                name: DELETED_USER_NAME,
                email: null,
                emailVerified: null,
                image: null,
                password: null,
                phone: null,
                upiId: null,
                tokenVersion: { increment: 1 },
            },
        });

        return { groupsLeft: groups.length, groupsHandedOver, groupsClosed };
    };

    try {
        return await prisma.$transaction(run, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15_000 });
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
            throw new DeletionRefused('Something in your groups changed at the same moment. Please try again.');
        }
        throw error;
    }
}
