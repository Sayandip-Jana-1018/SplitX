import { requireCaller, v1Error, v1Json } from '@/lib/apiV1';
import { logger } from '@/lib/logger';
import { groupDetail } from '@/lib/v1/reads';

/**
 * GET /api/v1/groups/:groupId: one group's people, balances and the fewest
 * payments that settle it. A group you aren't in answers the same 404 as one
 * that doesn't exist.
 */
export async function GET(request: Request, { params }: { params: Promise<{ groupId: string }> }) {
    const auth = await requireCaller(request);
    if (!auth.ok) return auth.response;
    const { groupId } = await params;
    try {
        const detail = await groupDetail(auth.caller.userId, groupId);
        return detail ? v1Json(detail) : v1Error('That group isn’t here.', 404, 'not_found');
    } catch (error) {
        logger.error('Phone group read failed', { err: error });
        return v1Error('Couldn’t load that group. Try again.', 500, 'server_error');
    }
}
