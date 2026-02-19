import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { isFeatureEnabled } from '@/lib/featureFlags';

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

        const notifications = await prisma.notification.findMany({
            where: { userId: user.id },
            orderBy: { createdAt: 'desc' },
            take: 50,
        });

        const unreadCount = await prisma.notification.count({
            where: { userId: user.id, read: false },
        });

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
        const { userId, type, title, body: notifBody, link } = body as {
            userId: string;
            type: string;
            title: string;
            body: string;
            link?: string;
        };

        if (!userId || !type || !title || !notifBody) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        // Prevent sending notifications to yourself
        if (userId === sender.id) {
            return NextResponse.json({ error: 'Cannot send notification to yourself' }, { status: 400 });
        }

        const notification = await prisma.notification.create({
            data: { userId, type, title, body: notifBody, link },
        });

        return NextResponse.json(notification, { status: 201 });
    } catch (error) {
        console.error('Notifications POST error:', error);
        return NextResponse.json({ error: 'Failed to create notification' }, { status: 500 });
    }
}
