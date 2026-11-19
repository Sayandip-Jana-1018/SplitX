import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { z } from 'zod';
import { loadGroupLedger, planLedgerTransfers } from '@/lib/ledger';
import { formatCurrency } from '@/lib/utils';
import { logger } from '@/lib/logger';
import { pushToPhones } from '@/lib/notifications';
import { markRead, yourNotifications } from '@/lib/services/notificationsList';

/**
 * A person can send one kind of notification: a reminder to someone who owes
 * them. The server writes its title, text and link. It used to take all three
 * from the request, so any member could send anyone in a shared group a
 * message with any link in it.
 */
const ReminderSchema = z.object({
    userId: z.string().min(1).max(64),
    groupId: z.string().min(1).max(64),
});

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

        const { notifications, unreadCount } = await yourNotifications(user.id);

        return NextResponse.json({ data: notifications, unreadCount });
    } catch (error) {
        logger.error('Notifications GET error', { err: error });
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

        const body = await req.json().catch(() => null);
        if (!body || typeof body !== 'object') {
            return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
        }
        const { ids, markAll } = body as { ids?: string[]; markAll?: boolean };

        await markRead(user.id, { ids, all: markAll });

        return NextResponse.json({ success: true });
    } catch (error) {
        logger.error('Notifications PATCH error', { err: error });
        return NextResponse.json({ error: 'Failed to update notifications' }, { status: 500 });
    }
}

// POST /api/notifications — remind someone in a shared group that they owe you.
export async function POST(req: Request) {
    try {
        const session = await auth();
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const sender = await prisma.user.findUnique({ where: { email: session.user.email } });
        if (!sender) return NextResponse.json({ error: 'User not found' }, { status: 404 });

        const parsed = ReminderSchema.safeParse(await req.json().catch(() => null));
        if (!parsed.success) {
            return NextResponse.json({ error: 'Choose who to remind, and in which group' }, { status: 400 });
        }
        const { userId, groupId } = parsed.data;

        if (userId === sender.id) {
            return NextResponse.json({ error: 'Cannot send notification to yourself' }, { status: 400 });
        }

        // Both must be in the group; what is owed comes from its settle-up plan.
        const ledger = await loadGroupLedger(groupId);
        const inGroup = (id: string) => Boolean(ledger?.members.some((member) => member.id === id));
        if (!ledger || !inGroup(sender.id) || !inGroup(userId)) {
            return NextResponse.json({ error: 'You can only remind people in your groups' }, { status: 403 });
        }
        const owed = planLedgerTransfers(ledger)
            .filter((transfer) => transfer.from === userId && transfer.to === sender.id)
            .reduce((sum, transfer) => sum + transfer.amount, 0);
        if (owed === 0) {
            return NextResponse.json({ error: 'They don’t owe you anything in this group' }, { status: 400 });
        }

        // At most one reminder a minute from one person to another.
        const recentReminder = await prisma.notification.findFirst({
            where: {
                userId,
                actorId: sender.id,
                type: 'payment_reminder',
                createdAt: { gte: new Date(Date.now() - 60_000) },
            },
        });
        if (recentReminder) {
            return NextResponse.json(
                { error: 'Reminder already sent recently. Try again in a minute.' },
                { status: 429 }
            );
        }

        const notification = await prisma.notification.create({
            data: {
                user: { connect: { id: userId } },
                actor: { connect: { id: sender.id } },
                type: 'payment_reminder',
                title: 'Payment reminder',
                body: `${sender.name || 'Someone'} is reminding you to pay ${formatCurrency(owed)} in ${ledger.groupName}.`,
                link: '/settlements',
            },
        });
        pushToPhones([notification]);

        return NextResponse.json(notification, { status: 201 });
    } catch (error) {
        logger.error('Notifications POST error', { err: error });
        return NextResponse.json({ error: 'Failed to create notification' }, { status: 500 });
    }
}
