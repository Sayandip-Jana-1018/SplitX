import { meOf, readV1Body, requireCaller, v1Error, v1Json } from '@/lib/apiV1';
import { ProfileUpdate } from '@/lib/contract/v1';
import { updateProfile } from '@/lib/v1/auth';

/** GET /api/v1/me: the signed-in account, as the app shows it. */
export async function GET(request: Request) {
    const auth = await requireCaller(request);
    if (!auth.ok) return auth.response;
    const me = await meOf(auth.caller.userId);
    return me ? v1Json({ me }) : v1Error('Your session has ended. Sign in again.', 401, 'unauthenticated');
}

/** PATCH /api/v1/me: your name and UPI ID, by the website's profile rules. */
export async function PATCH(request: Request) {
    const auth = await requireCaller(request);
    if (!auth.ok) return auth.response;
    const body = await readV1Body(request, ProfileUpdate);
    if (!body.ok) return body.response;
    const me = await updateProfile(auth.caller.userId, body.data);
    return me ? v1Json({ me }) : v1Error('Your session has ended. Sign in again.', 401, 'unauthenticated');
}
