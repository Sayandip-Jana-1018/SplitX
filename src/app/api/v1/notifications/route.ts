import { requireCaller, v1Error, v1Json } from '@/lib/apiV1';
import type { AppNotification, NotificationList } from '@/lib/contract/v1';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { logger } from '@/lib/logger';
import { yourNotifications } from '@/lib/services/notificationsList';

/** GET /api/v1/notifications: your newest 50, and how many are unread (the website's bell). */
export async function GET(request: Request) {
    const auth = await requireCaller(request);
    if (!auth.ok) return auth.response;
    try {
        if (!isFeatureEnabled('notifications')) return v1Json({ notifications: [], unread: 0 } satisfies NotificationList);
        const { notifications, unreadCount } = await yourNotifications(auth.caller.userId);
        const answer: NotificationList = {
            notifications: notifications.map((n): AppNotification => ({ id: n.id, type: n.type, title: n.title, body: n.body, link: n.link, read: n.read, createdAt: n.createdAt.toISOString(), fromName: n.actor?.name ?? null })),
            unread: unreadCount,
        };
        return v1Json(answer);
    } catch (error) {
        logger.error('Phone notifications read failed', { err: error });
        return v1Error('Couldn’t load your notifications. Try again.', 500, 'server_error');
    }
}
