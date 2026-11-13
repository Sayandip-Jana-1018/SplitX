import { requireCaller, v1Error, v1Json } from '@/lib/apiV1';
import { ActivityQuery } from '@/lib/contract/v1';
import { logger } from '@/lib/logger';
import { activityFeed } from '@/lib/v1/reads';

/**
 * GET /api/v1/activity?groupId=&before=&limit=: expenses and settlements,
 * newest first, with what each did to your balance. Page on with `before` set
 * to the last page's `nextBefore`.
 */
export async function GET(request: Request) {
    const auth = await requireCaller(request);
    if (!auth.ok) return auth.response;
    const parsed = ActivityQuery.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) return v1Error('That activity request isn’t valid.', 400, 'invalid_input');
    try {
        const page = await activityFeed(auth.caller.userId, parsed.data);
        return page ? v1Json(page) : v1Error('That group isn’t here.', 404, 'not_found');
    } catch (error) {
        logger.error('Phone activity read failed', { err: error });
        return v1Error('Couldn’t load the activity. Try again.', 500, 'server_error');
    }
}
