import { readV1Body, requireCaller, v1Error, v1Json } from '@/lib/apiV1';
import { NewSettlement } from '@/lib/contract/v1';
import { logger } from '@/lib/logger';
import { askSettlement } from '@/lib/v1/writes';

/**
 * POST /api/v1/settlements: asks for a payment (or, as the receiver, records
 * one made to you). The server checks it fits the group's balances. 201 when
 * new; 200 with `reused: true` when the same request was already open.
 */
export async function POST(request: Request) {
    const auth = await requireCaller(request);
    if (!auth.ok) return auth.response;
    const body = await readV1Body(request, NewSettlement);
    if (!body.ok) return body.response;
    try {
        const outcome = await askSettlement(auth.caller.userId, body.data);
        if (!outcome.ok) return v1Error(outcome.error, outcome.status, outcome.code);
        return v1Json(outcome.value, outcome.value.reused ? 200 : 201);
    } catch (error) {
        logger.error('Phone settlement request failed', { err: error });
        return v1Error('Couldn’t record that payment. Try again.', 500, 'server_error');
    }
}
