import { prisma } from '@/lib/db';

/**
 * The notifications list, for the website (/api/notifications) and the phone app
 * (/api/v1/notifications) alike (docs/mobile/ROADMAP.md, Phase 4 step 6).
 */

function extractGroupIdFromLink(link?: string | null) {
    if (!link) return null;
    const match = link.match(/^\/groups\/([^/?#]+)/);
    return match?.[1] || null;
}

/**
 * Your newest 50 notifications and how many are unread, for the website's bell and the phone's
 * list alike. Unread ones about a group you're no longer in (or that was deleted) are cleared
 * first, so nobody is pointed at a group they can't open.
 */
export async function yourNotifications(userId: string) {
    const [recentNotifications, unreadGroupNotifications] = await Promise.all([
        prisma.notification.findMany({
            where: { userId },
            include: {
                actor: { select: { name: true, image: true } },
            },
            orderBy: { createdAt: 'desc' },
            take: 50,
        }),
        prisma.notification.findMany({
            where: {
                userId,
                read: false,
                link: { startsWith: '/groups/' },
            },
            select: { id: true, link: true },
        }),
    ]);

    const linkedGroupIds = new Set<string>();
    for (const notification of recentNotifications) {
        const groupId = extractGroupIdFromLink(notification.link);
        if (groupId) linkedGroupIds.add(groupId);
    }
    for (const notification of unreadGroupNotifications) {
        const groupId = extractGroupIdFromLink(notification.link);
        if (groupId) linkedGroupIds.add(groupId);
    }

    if (linkedGroupIds.size === 0) {
        return {
            notifications: recentNotifications,
            unreadCount: recentNotifications.filter((notification) => !notification.read).length,
        };
    }

    const accessibleGroups = await prisma.group.findMany({
        where: {
            id: { in: Array.from(linkedGroupIds) },
            deletedAt: null,
            OR: [
                { ownerId: userId },
                { members: { some: { userId } } },
            ],
        },
        select: { id: true },
    });

    const accessibleGroupIds = new Set(accessibleGroups.map((group) => group.id));
    const staleNotificationIds = new Set<string>();

    for (const notification of recentNotifications) {
        const groupId = extractGroupIdFromLink(notification.link);
        if (groupId && !accessibleGroupIds.has(groupId)) {
            staleNotificationIds.add(notification.id);
        }
    }

    for (const notification of unreadGroupNotifications) {
        const groupId = extractGroupIdFromLink(notification.link);
        if (groupId && !accessibleGroupIds.has(groupId)) {
            staleNotificationIds.add(notification.id);
        }
    }

    if (staleNotificationIds.size > 0) {
        await prisma.notification.deleteMany({
            where: {
                userId,
                id: { in: Array.from(staleNotificationIds) },
            },
        });
    }

    const notifications = recentNotifications.filter(
        (notification) => !staleNotificationIds.has(notification.id)
    );

    return {
        notifications,
        unreadCount: notifications.filter((notification) => !notification.read).length,
    };
}

/**
 * GET /api/notifications — list user's notifications (newest first, max 50)
 * PATCH /api/notifications — mark notifications as read
 */

/** Marks some of your notifications read, or all of them. */
export async function markRead(userId: string, which: { ids?: string[]; all?: boolean }) {
    if (which.all) {
        await prisma.notification.updateMany({ where: { userId, read: false }, data: { read: true } });
    } else if (which.ids && which.ids.length > 0) {
        await prisma.notification.updateMany({ where: { id: { in: which.ids }, userId }, data: { read: true } });
    }
}
