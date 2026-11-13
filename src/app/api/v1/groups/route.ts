import { requireCaller, v1Error, v1Json } from '@/lib/apiV1';
import { logger } from '@/lib/logger';
import { listGroups } from '@/lib/v1/reads';

/** GET /api/v1/groups: your groups, with where you stand in each. */
export async function GET(request: Request) {
    const auth = await requireCaller(request);
    if (!auth.ok) return auth.response;
    try {
        return v1Json({ groups: await listGroups(auth.caller.userId) });
    } catch (error) {
        logger.error('Phone groups read failed', { err: error });
        return v1Error('Couldn’t load your groups. Try again.', 500, 'server_error');
    }
}
