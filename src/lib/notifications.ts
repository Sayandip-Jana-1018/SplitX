import { after } from 'next/server';
import { prisma } from '@/lib/db';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { logger } from '@/lib/logger';
import { sendPush } from '@/lib/push';

/** An in-app notification as saved, which is also what its push says. */
export interface NotifiedRow {
    userId: string;
    title: string;
    body: string;
    link?: string | null;
    type?: string;
}

/**
 * Sends saved notifications to their recipients' phones as pushes, after the
 * response has gone (next/server's after), so a slow push never slows a save.
 * Rows saying the same thing go as one send to all their recipients. Outside a
 * request (a script, a test) it simply runs in the background.
 */
export function pushToPhones(rows: readonly NotifiedRow[]) {
    if (rows.length === 0) return;
    const sends = new Map<string, { userIds: string[]; title: string; body: string; link?: string | null; type?: string }>();
    for (const row of rows) {
        const key = JSON.stringify([row.title, row.body, row.link ?? '', row.type ?? '']);
        const send = sends.get(key) ?? { userIds: [], title: row.title, body: row.body, link: row.link, type: row.type };
        send.userIds.push(row.userId);
        sends.set(key, send);
    }
    const work = async () => {
        await Promise.all([...sends.values()].map(({ userIds, ...message }) => sendPush(userIds, message)));
    };
    try {
        after(work);
    } catch {
        void work();
    }
}

// ═══════════════════════════════════════════════════════════════
// Notification Creator — call from any API route to trigger
// notifications for users in real-time.
// ═══════════════════════════════════════════════════════════════

type NotificationType =
    | 'payment_reminder'
    | 'new_expense'
    | 'settlement_approval_request'
    | 'settlement_completed'
    | 'settlement_rejected'
    | 'group_activity'
    | 'group_invite'
    | 'group_invite_accepted';

interface CreateNotificationParams {
    userId: string;
    actorId?: string;
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
        const saved = await prisma.notification.create({
            data: {
                userId: params.userId,
                actorId: params.actorId,
                type: params.type,
                title: params.title,
                body: params.body,
                link: params.link,
            },
        });
        pushToPhones([params]);
        return saved;
    } catch (error) {
        logger.error('Failed to create notification', { err: error });
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
        const rows = userIds.map(userId => ({
            userId,
            actorId: params.actorId,
            type: params.type,
            title: params.title,
            body: params.body,
            link: params.link,
        }));
        await prisma.notification.createMany({ data: rows });
        pushToPhones(rows);
    } catch (error) {
        logger.error('Failed to create bulk notifications', { err: error });
    }
}
