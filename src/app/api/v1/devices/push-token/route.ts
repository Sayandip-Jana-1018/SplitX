import { after, NextResponse } from 'next/server';
import { readV1Body, requireCaller, v1Error } from '@/lib/apiV1';
import { PushTokenUpdate } from '@/lib/contract/v1';
import { logger } from '@/lib/logger';
import { setPushToken } from '@/lib/mobileAuth';
import { sendPush } from '@/lib/push';

/**
 * PUT /api/v1/devices/push-token: where this phone's push notifications go
 * (its Firebase Cloud Messaging token), or null to stop them. 204.
 *
 * When a phone turns notifications on (a token it didn't hold before), that
 * phone alone gets one confirmation, after the response: it shows the person
 * what SplitIT's notifications look like, and proves the whole path works.
 * The same token sent again (the app does on every open) sends nothing.
 */
export async function PUT(request: Request) {
    const auth = await requireCaller(request);
    if (!auth.ok) return auth.response;
    const body = await readV1Body(request, PushTokenUpdate);
    if (!body.ok) return body.response;
    try {
        const { turnedOn } = await setPushToken(auth.caller, body.data.token);
        if (turnedOn) {
            const { userId, deviceId } = auth.caller;
            const confirm = () => sendPush([userId], { title: 'Notifications are on', body: 'SplitIT will tell you here when friends add an expense, pay you back, or remind you.', link: '/home', type: 'push_enabled' }, new Date(), deviceId);
            try {
                after(confirm);
            } catch {
                void confirm();
            }
        }
        return new NextResponse(null, { status: 204 });
    } catch (error) {
        logger.error('Phone push token save failed', { err: error });
        return v1Error('Couldn’t turn on notifications just now. Try again.', 500, 'server_error');
    }
}
