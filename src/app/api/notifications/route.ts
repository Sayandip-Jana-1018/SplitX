import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { z } from 'zod';

const CreateNotificationSchema = z.object({
    userId: z.string().min(1),
    type: z.string().min(1),
    title: z.string().min(1).max(200),
    body: z.string().min(1).max(500),
    link: z.string().optional(),
});

function extractGroupIdFromLink(link?: string | null) {
    if (!link) return null;
    const match = link.match(/^\/groups\/([^/?#]+)/);
    return match?.[1] || null;
}

async function cleanupStaleGroupNotifications(userId: string) {
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

export async function GET() {
    try {
        if (!isFeatureEnabled('notifications')) {
            return NextResponse.json({ data: [] });
        }

        const session = await auth();
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const user = await prisma.user.findUnique({ where: { email: session.user.email } });
        if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

        const { notifications, unreadCount } = await cleanupStaleGroupNotifications(user.id);

        return NextResponse.json({ data: notifications, unreadCount });
    } catch (error) {
        console.error('Notifications GET error:', error);
        return NextResponse.json({ error: 'Failed to fetch notifications' }, { status: 500 });
    }
}

export async function PATCH(req: Request) {
    try {
        const session = await auth();
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const user = await prisma.user.findUnique({ where: { email: session.user.email } });
        if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

        const body = await req.json();
        const { ids, markAll } = body as { ids?: string[]; markAll?: boolean };

        if (markAll) {
            await prisma.notification.updateMany({
                where: { userId: user.id, read: false },
                data: { read: true },
            });
        } else if (ids && ids.length > 0) {
            await prisma.notification.updateMany({
                where: { id: { in: ids }, userId: user.id },
                data: { read: true },
            });
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Notifications PATCH error:', error);
        return NextResponse.json({ error: 'Failed to update notifications' }, { status: 500 });
    }
}

// POST /api/notifications — create a notification for another user (e.g., payment reminders)
export async function POST(req: Request) {
    try {
        const session = await auth();
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const sender = await prisma.user.findUnique({ where: { email: session.user.email } });
        if (!sender) return NextResponse.json({ error: 'User not found' }, { status: 404 });

        const body = await req.json();
        const parsed = CreateNotificationSchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid request body' }, { status: 400 });
        }

        const { userId, type, title, body: notifBody, link } = parsed.data;

        // Prevent sending notifications to yourself
        if (userId === sender.id) {
            return NextResponse.json({ error: 'Cannot send notification to yourself' }, { status: 400 });
        }

        // Rate limit: max 1 reminder per pair per minute
        if (type === 'payment_reminder') {
            const oneMinuteAgo = new Date(Date.now() - 60_000);
            const recentReminder = await prisma.notification.findFirst({
                where: {
                    userId,
                    actorId: sender.id,
                    type: 'payment_reminder',
                    createdAt: { gte: oneMinuteAgo },
                },
            });
            if (recentReminder) {
                return NextResponse.json(
                    { error: 'Reminder already sent recently. Try again in a minute.' },
                    { status: 429 }
                );
            }
        }

        // Security: Verify sender and recipient share at least one group
        const sharedGroup = await prisma.group.findFirst({
            where: {
                deletedAt: null,
                AND: [
                    { OR: [{ ownerId: sender.id }, { members: { some: { userId: sender.id } } }] },
                    { OR: [{ ownerId: userId }, { members: { some: { userId } } }] },
                ],
            },
            select: { id: true },
        });
        if (!sharedGroup) {
            return NextResponse.json({ error: 'You can only send notifications to users in your groups' }, { status: 403 });
        }

        const notification = await prisma.notification.create({
            data: { user: { connect: { id: userId } }, actor: { connect: { id: sender.id } }, type, title, body: notifBody, link },
        });

        return NextResponse.json(notification, { status: 201 });
    } catch (error) {
        console.error('Notifications POST error:', error);
        return NextResponse.json({ error: 'Failed to create notification' }, { status: 500 });
    }
}
