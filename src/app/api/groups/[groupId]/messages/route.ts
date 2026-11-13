import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { ChatRefused, listGroupMessages, sendGroupMessage } from '@/lib/services/groupChat';

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
        const limit = Math.min(Number.parseInt(searchParams.get('limit') || '30', 10), 50);

        const user = await prisma.user.findUnique({ where: { email: session.user.email } });
        if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

        // The rules themselves are shared with the phone app (lib/services/groupChat.ts).
        const page = await listGroupMessages(user.id, groupId, { cursor, limit });
        if (!page) return NextResponse.json({ error: 'Not a member of this group' }, { status: 403 });
        return NextResponse.json(page);
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

        try {
            const message = await sendGroupMessage(user, groupId, { content, type, targetUserId });
            return NextResponse.json({ message });
        } catch (error) {
            if (error instanceof ChatRefused) return NextResponse.json({ error: error.message }, { status: error.status });
            throw error;
        }
    } catch (error) {
        logger.error('Group messages POST error', { err: error });
        return NextResponse.json({ error: 'Failed to send message' }, { status: 500 });
    }
}
