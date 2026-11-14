import { readV1Body, requireCaller, v1Error, v1Json } from '@/lib/apiV1';
import { SyncRequest } from '@/lib/contract/v1';
import { logger } from '@/lib/logger';
import { syncLedgers } from '@/lib/v1/sync';

/**
 * POST /api/v1/sync: { known: { groupId: version } } in; every group you're in
 * now out, with the changed ones in full (src/lib/v1/sync.ts).
 */
export async function POST(request: Request) {
    const auth = await requireCaller(request);
    if (!auth.ok) return auth.response;
    const body = await readV1Body(request, SyncRequest);
    if (!body.ok) return body.response;
    try {
        return v1Json(await syncLedgers(auth.caller.userId, body.data.known));
    } catch (error) {
        logger.error('Phone sync failed', { err: error });
        return v1Error('Couldn’t bring your groups up to date. Showing what’s on your phone.', 500, 'server_error');
    }
}
