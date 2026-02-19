import { prisma } from '@/lib/db';
import { isFeatureEnabled } from '@/lib/featureFlags';

// ═══════════════════════════════════════════════════════════════
// Notification Creator — call from any API route to trigger
// notifications for users in real-time.
// ═══════════════════════════════════════════════════════════════

type NotificationType =
    | 'payment_reminder'
    | 'new_expense'
    | 'settlement_completed'
    | 'group_activity'
    | 'group_invite'
    | 'group_invite_accepted';

interface CreateNotificationParams {
    userId: string;
    type: NotificationType;
    title: string;
    body: string;
    link?: string;
}

/**
 * Create a notification for a user.
 * Silently no-ops if the notifications feature is disabled.
 */
export async function createNotification(params: CreateNotificationParams) {
    if (!isFeatureEnabled('notifications')) return null;

    try {
        return await prisma.notification.create({
            data: {
                userId: params.userId,
                type: params.type,
                title: params.title,
                body: params.body,
                link: params.link,
            },
        });
    } catch (error) {
        console.error('Failed to create notification:', error);
        return null;
    }
}

/**
 * Create notifications for multiple users (e.g., all group members).
 */
export async function createBulkNotifications(
    userIds: string[],
    params: Omit<CreateNotificationParams, 'userId'>
) {
    if (!isFeatureEnabled('notifications')) return;

    try {
        await prisma.notification.createMany({
            data: userIds.map(userId => ({
                userId,
                type: params.type,
                title: params.title,
                body: params.body,
                link: params.link,
            })),
        });
    } catch (error) {
        console.error('Failed to create bulk notifications:', error);
    }
}
