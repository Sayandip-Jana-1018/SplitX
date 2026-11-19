import { NextResponse } from 'next/server';
import { readV1Body, requireCaller, v1Error } from '@/lib/apiV1';
import { MarkRead } from '@/lib/contract/v1';
import { logger } from '@/lib/logger';
import { markRead } from '@/lib/services/notificationsList';

/** POST /api/v1/notifications/read: marks some of your notifications read, or all of them. */
export async function POST(request: Request) {
    const auth = await requireCaller(request);
    if (!auth.ok) return auth.response;
    const body = await readV1Body(request, MarkRead);
    if (!body.ok) return body.response;
    try {
        await markRead(auth.caller.userId, body.data);
        return new NextResponse(null, { status: 204 });
    } catch (error) {
        logger.error('Phone notifications mark-read failed', { err: error });
        return v1Error('Couldn’t mark them read. Try again.', 500, 'server_error');
    }
}
