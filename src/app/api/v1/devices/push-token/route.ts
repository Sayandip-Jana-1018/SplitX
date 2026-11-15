import { NextResponse } from 'next/server';
import { readV1Body, requireCaller, v1Error } from '@/lib/apiV1';
import { PushTokenUpdate } from '@/lib/contract/v1';
import { logger } from '@/lib/logger';
import { setPushToken } from '@/lib/mobileAuth';

/**
 * PUT /api/v1/devices/push-token: where this phone's push notifications go
 * (its Firebase Cloud Messaging token), or null to stop them. 204.
 */
export async function PUT(request: Request) {
    const auth = await requireCaller(request);
    if (!auth.ok) return auth.response;
    const body = await readV1Body(request, PushTokenUpdate);
    if (!body.ok) return body.response;
    try {
        await setPushToken(auth.caller, body.data.token);
        return new NextResponse(null, { status: 204 });
    } catch (error) {
        logger.error('Phone push token save failed', { err: error });
        return v1Error('Couldn’t turn on notifications just now. Try again.', 500, 'server_error');
    }
}
