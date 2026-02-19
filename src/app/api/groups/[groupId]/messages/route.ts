import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';

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

        // Verify membership
        const group = await prisma.group.findFirst({
            where: {
                id: groupId,
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
        console.error('Group messages GET error:', error);
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
        const body = await req.json();
        const { content, type = 'text', settlementId, transactionId, targetUserId } = body as {
            content: string;
            type?: string;
            settlementId?: string;
            transactionId?: string;
            targetUserId?: string;
        };

        if (!content?.trim()) {
            return NextResponse.json({ error: 'Message content is required' }, { status: 400 });
        }

        const user = await prisma.user.findUnique({ where: { email: session.user.email } });
        if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

        // Verify membership
        const group = await prisma.group.findFirst({
            where: {
                id: groupId,
                OR: [
                    { ownerId: user.id },
                    { members: { some: { userId: user.id } } },
                ],
            },
            select: { id: true, name: true },
        });

        if (!group) {
            return NextResponse.json({ error: 'Not a member of this group' }, { status: 403 });
        }

        // Create the message
        const message = await prisma.groupMessage.create({
            data: {
                groupId,
                senderId: user.id,
                content: content.trim(),
                type,
                ...(settlementId ? { settlementId } : {}),
                ...(transactionId ? { transactionId } : {}),
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
                    userId: targetUserId,
                    type: 'payment_reminder',
                    title: 'Payment Reminder',
                    body: `${user.name || 'Someone'} sent you a payment reminder in ${group.name}.`,
                    link: `/groups/${groupId}`,
                },
            });
        }

        return NextResponse.json({ message });
    } catch (error) {
        console.error('Group messages POST error:', error);
        return NextResponse.json({ error: 'Failed to send message' }, { status: 500 });
    }
}
