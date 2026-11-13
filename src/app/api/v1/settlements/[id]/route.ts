import { readV1Body, requireCaller, v1Error, v1Json } from '@/lib/apiV1';
import { SettlementMove } from '@/lib/contract/v1';
import { logger } from '@/lib/logger';
import { moveSettlement } from '@/lib/v1/writes';

/**
 * POST /api/v1/settlements/:id: one step of a settlement, by the side it
 * belongs to (src/lib/settlementTransitions.ts). Of two taps at once, one
 * lands; the other is told why not.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const auth = await requireCaller(request);
    if (!auth.ok) return auth.response;
    const body = await readV1Body(request, SettlementMove);
    if (!body.ok) return body.response;
    const { id } = await params;
    try {
        const outcome = await moveSettlement(auth.caller.userId, id, body.data);
        return outcome.ok ? v1Json(outcome.value) : v1Error(outcome.error, outcome.status, outcome.code);
    } catch (error) {
        logger.error('Phone settlement step failed', { err: error });
        return v1Error('Couldn’t update that payment. Try again.', 500, 'server_error');
    }
}
