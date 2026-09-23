import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { logger } from '@/lib/logger';

const SendMessageSchema = z.object({
    content: z.string().trim().min(1).max(1_000),
    type: z.enum(['text', 'payment_reminder']).default('text'),
    targetUserId: z.string().min(1).max(64).optional(),
});

// GET /api/groups/:groupId/messages — Fetch paginated group messages
export async function GET(
    req: Request,
    { params }: { params: Promise<{ groupId: string }> }
) {
    try {
        const session = await auth();
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { groupId } = await params;
        const { searchParams } = new URL(req.url);
        const cursor = searchParams.get('cursor');
        const limit = Math.min(parseInt(searchParams.get('limit') || '30'), 50);

        const user = await prisma.user.findUnique({ where: { email: session.user.email } });
        if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

        // Verify membership (a deleted group's chat is gone too)
        const group = await prisma.group.findFirst({
            where: {
                id: groupId,
                deletedAt: null,
                OR: [
                    { ownerId: user.id },
                    { members: { some: { userId: user.id } } },
                ],
            },
            select: { id: true },
        });

        if (!group) {
            return NextResponse.json({ error: 'Not a member of this group' }, { status: 403 });
        }

        const messages = await prisma.groupMessage.findMany({
            where: { groupId },
            orderBy: { createdAt: 'desc' },
            take: limit + 1, // fetch one extra to know if there's more
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
            include: {
                sender: { select: { id: true, name: true, image: true } },
                settlement: {
                    select: {
                        id: true,
                        amount: true,
                        status: true,
                        from: { select: { id: true, name: true } },
                        to: { select: { id: true, name: true } },
                    },
                },
                transaction: {
                    select: {
                        id: true,
                        title: true,
                        amount: true,
                        category: true,
                    },
                },
            },
        });

        const hasMore = messages.length > limit;
        const data = hasMore ? messages.slice(0, limit) : messages;
        const nextCursor = hasMore ? data[data.length - 1]?.id : null;

        return NextResponse.json({
            messages: data.reverse(), // Return in chronological order
            nextCursor,
            hasMore,
        });
    } catch (error) {
        logger.error('Group messages GET error', { err: error });
        return NextResponse.json({ error: 'Failed to fetch messages' }, { status: 500 });
    }
}

// POST /api/groups/:groupId/messages — Send a message
export async function POST(
    req: Request,
    { params }: { params: Promise<{ groupId: string }> }
) {
    try {
        const session = await auth();
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { groupId } = await params;
        // People send text and payment reminders. System messages, and messages
        // carrying a settlement or an expense, are written by the server alone:
        // a client could otherwise post a fake "✅ confirmed" or attach another
        // group's money.
        const parsed = SendMessageSchema.safeParse(await req.json().catch(() => null));
        if (!parsed.success) {
            const issue = parsed.error.issues[0];
            return NextResponse.json(
                { error: issue?.path[0] === 'content' ? 'Message content is required, up to 1,000 characters' : 'Invalid message' },
                { status: 400 }
            );
        }
        const { content, type, targetUserId } = parsed.data;

        const user = await prisma.user.findUnique({ where: { email: session.user.email } });
        if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

        // Verify membership
        const group = await prisma.group.findFirst({
            where: {
                id: groupId,
                deletedAt: null,
                OR: [
                    { ownerId: user.id },
                    { members: { some: { userId: user.id } } },
                ],
            },
            select: {
                id: true,
                name: true,
                ownerId: true,
                members: { select: { userId: true } },
            },
        });

        if (!group) {
            return NextResponse.json({ error: 'Not a member of this group' }, { status: 403 });
        }

        if (type === 'payment_reminder') {
            if (!targetUserId) {
                return NextResponse.json({ error: 'A target user is required for payment reminders' }, { status: 400 });
            }

            const allowedTargetIds = new Set<string>([
                group.ownerId,
                ...group.members.map((member) => member.userId),
            ]);

            if (!allowedTargetIds.has(targetUserId)) {
                return NextResponse.json({ error: 'Target user is not a member of this group' }, { status: 400 });
            }
        }

        // Rate limit: max 5 messages per 10 seconds per user per group
        const tenSecondsAgo = new Date(Date.now() - 10_000);
        const recentCount = await prisma.groupMessage.count({
            where: {
                groupId,
                senderId: user.id,
                createdAt: { gte: tenSecondsAgo },
            },
        });
        if (recentCount >= 5) {
            return NextResponse.json(
                { error: 'Slow down! You\'re sending messages too quickly.' },
                { status: 429 }
            );
        }

        // Create the message
        const message = await prisma.groupMessage.create({
            data: {
                groupId,
                senderId: user.id,
                content,
                type,
            },
            include: {
                sender: { select: { id: true, name: true, image: true } },
                settlement: {
                    select: {
                        id: true,
                        amount: true,
                        status: true,
                        from: { select: { id: true, name: true } },
                        to: { select: { id: true, name: true } },
                    },
                },
                transaction: {
                    select: {
                        id: true,
                        title: true,
                        amount: true,
                        category: true,
                    },
                },
            },
        });

        // For payment_reminder type → also create a notification for the target user
        if (type === 'payment_reminder' && targetUserId) {
            await prisma.notification.create({
                data: {
                    user: { connect: { id: targetUserId } },
                    type: 'payment_reminder',
                    title: 'Payment Reminder',
                    body: `${user.name || 'Someone'} sent you a payment reminder in ${group.name}.`,
                    link: `/groups/${groupId}`,
                },
            });
        }

        return NextResponse.json({ message });
    } catch (error) {
        logger.error('Group messages POST error', { err: error });
        return NextResponse.json({ error: 'Failed to send message' }, { status: 500 });
    }
}
