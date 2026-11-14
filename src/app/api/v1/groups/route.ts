import { readV1Body, requireCaller, v1Error, v1Json } from '@/lib/apiV1';
import { NewGroup } from '@/lib/contract/v1';
import { logger } from '@/lib/logger';
import { createGroup } from '@/lib/services/groups';
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

/** POST /api/v1/groups: a new group, with you as its admin. 201 with its id; a sync brings it whole. */
export async function POST(request: Request) {
    const auth = await requireCaller(request);
    if (!auth.ok) return auth.response;
    const body = await readV1Body(request, NewGroup);
    if (!body.ok) return body.response;
    try {
        const group = await createGroup(auth.caller.userId, body.data);
        return v1Json({ groupId: group.id }, 201);
    } catch (error) {
        logger.error('Phone group create failed', { err: error });
        return v1Error('Couldn’t make the group. Try again.', 500, 'server_error');
    }
}
