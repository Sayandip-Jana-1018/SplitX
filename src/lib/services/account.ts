import { deleteAccount } from '@/lib/accountDeletion';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import { RECEIPTS_BUCKET } from '@/lib/receiptUrl';
import { forgetTokenVersion } from '@/lib/sessionVersion';
import { removeAvatars } from '@/lib/storage';

/**
 * Your account, for the website (/api/me) and the phone app (/api/v1/me, /api/v1/devices) alike:
 * your data as a file, closing the account, and the phones signed in to it
 * (docs/mobile/ROADMAP.md, Phase 4 step 5).
 */

/** Everything the app holds about you, as one JSON document. Null when the account isn't there. */
export async function exportAccount(userId: string) {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
            id: true,
            name: true,
            email: true,
            image: true,
            phone: true,
            upiId: true,
            createdAt: true,
        },
    });
    if (!user) return null;

    const [
        memberships,
        ownedGroups,
        transactionsPaid,
        transactionSplits,
        settlementsFrom,
        settlementsTo,
        budgets,
        contacts,
        notifications,
    ] = await Promise.all([
        prisma.groupMember.findMany({
            where: { userId: user.id },
            include: {
                group: {
                    select: {
                        id: true,
                        name: true,
                        emoji: true,
                        createdAt: true,
                        deletedAt: true,
                    },
                },
            },
            orderBy: { joinedAt: 'desc' },
        }),
        prisma.group.findMany({
            where: { ownerId: user.id },
            select: {
                id: true,
                name: true,
                emoji: true,
                createdAt: true,
                deletedAt: true,
            },
            orderBy: { createdAt: 'desc' },
        }),
        prisma.transaction.findMany({
            where: { payerId: user.id },
            select: {
                id: true,
                title: true,
                amount: true,
                category: true,
                method: true,
                splitType: true,
                createdAt: true,
                deletedAt: true,
                trip: {
                    select: {
                        id: true,
                        title: true,
                        group: { select: { id: true, name: true, emoji: true } },
                    },
                },
            },
            orderBy: { createdAt: 'desc' },
        }),
        prisma.splitItem.findMany({
            where: { userId: user.id },
            select: {
                id: true,
                amount: true,
                transaction: {
                    select: {
                        id: true,
                        title: true,
                        amount: true,
                        createdAt: true,
                        deletedAt: true,
                        payer: { select: { id: true, name: true } },
                        trip: {
                            select: {
                                id: true,
                                title: true,
                                group: { select: { id: true, name: true, emoji: true } },
                            },
                        },
                    },
                },
            },
            orderBy: { transaction: { createdAt: 'desc' } },
        }),
        prisma.settlement.findMany({
            where: { fromId: user.id, deletedAt: null },
            select: {
                id: true,
                amount: true,
                status: true,
                method: true,
                createdAt: true,
                to: { select: { id: true, name: true } },
                trip: {
                    select: {
                        id: true,
                        title: true,
                        group: { select: { id: true, name: true, emoji: true } },
                    },
                },
            },
            orderBy: { createdAt: 'desc' },
        }),
        prisma.settlement.findMany({
            where: { toId: user.id, deletedAt: null },
            select: {
                id: true,
                amount: true,
                status: true,
                method: true,
                createdAt: true,
                from: { select: { id: true, name: true } },
                trip: {
                    select: {
                        id: true,
                        title: true,
                        group: { select: { id: true, name: true, emoji: true } },
                    },
                },
            },
            orderBy: { createdAt: 'desc' },
        }),
        prisma.budget.findMany({
            where: { userId: user.id },
            orderBy: [{ month: 'desc' }, { category: 'asc' }],
        }),
        prisma.contact.findMany({
            where: { ownerId: user.id },
            orderBy: { addedAt: 'desc' },
        }),
        prisma.notification.findMany({
            where: { userId: user.id },
            select: {
                id: true,
                type: true,
                title: true,
                body: true,
                read: true,
                createdAt: true,
            },
            orderBy: { createdAt: 'desc' },
            take: 100,
        }),
    ]);

    return {
        exportedAt: new Date().toISOString(),
        user,
        groups: {
            memberships,
            owned: ownedGroups,
        },
        finances: {
            transactionsPaid,
            transactionSplits,
            settlementsFrom,
            settlementsTo,
            budgets,
        },
        contacts,
        notifications,
    };
}

/**
 * Closes the account (src/lib/accountDeletion.ts: refused with why while you owe or are owed), ends
 * every session on this server at once, and removes your profile photos. Throws DeletionRefused.
 */
export async function closeAccount(userId: string) {
    const outcome = await deleteAccount(userId);
    forgetTokenVersion(userId);
    try {
        await removeAvatars(userId, RECEIPTS_BUCKET);
    } catch (error) {
        // The account is gone either way; a photo left behind is logged to clear by hand.
        logger.warn('Could not remove the profile photos of a deleted account', { err: error });
    }
    return outcome;
}

// ── The phones signed in ────────────────────────────────────

/**
 * Your phones still signed in (and the one asking), the one asking first, then by when each was
 * last seen. A phone signed out leaves its record behind; it isn't listed, as there is nothing to
 * sign out there.
 */
export async function listDevices(userId: string, currentDeviceId: string, now = new Date()) {
    const devices = await prisma.device.findMany({
        where: { userId },
        select: {
            id: true,
            platform: true,
            name: true,
            appVersion: true,
            lastSeenAt: true,
            createdAt: true,
            refreshTokens: { where: { usedAt: null, revokedAt: null, expiresAt: { gt: now } }, select: { id: true }, take: 1 },
        },
        orderBy: { lastSeenAt: 'desc' },
    });
    return devices
        .map(({ refreshTokens, ...device }) => ({ ...device, current: device.id === currentDeviceId, signedIn: refreshTokens.length > 0 }))
        .filter((device) => device.signedIn || device.current)
        .sort((a, b) => Number(b.current) - Number(a.current));
}

/**
 * Signs one of your other phones out and forgets it: its sessions end and it gets no more pushes.
 * Not the phone asking, which signs out the usual way.
 */
export async function forgetDevice(userId: string, deviceId: string, currentDeviceId: string) {
    if (deviceId === currentDeviceId) return { ok: false, status: 400, error: 'This is the phone you’re using: sign out from Profile instead.', code: 'this_device' } as const;
    const removed = await prisma.device.deleteMany({ where: { id: deviceId, userId } });
    if (removed.count === 0) return { ok: false, status: 404, error: 'That phone isn’t signed in to your account.', code: 'not_found' } as const;
    return { ok: true } as const;
}
