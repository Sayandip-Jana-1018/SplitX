import { meOf, requireCaller, v1Error, v1Json } from '@/lib/apiV1';

/** GET /api/v1/me: the signed-in account, as the app shows it. */
export async function GET(request: Request) {
    const auth = await requireCaller(request);
    if (!auth.ok) return auth.response;
    const me = await meOf(auth.caller.userId);
    return me ? v1Json({ me }) : v1Error('Your session has ended. Sign in again.', 401, 'unauthenticated');
}
