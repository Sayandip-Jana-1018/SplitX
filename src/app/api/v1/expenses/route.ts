import { readV1Body, requireCaller, v1Error, v1Json } from '@/lib/apiV1';
import { NewExpense } from '@/lib/contract/v1';
import { logger } from '@/lib/logger';
import { saveExpense } from '@/lib/v1/writes';

/**
 * POST /api/v1/expenses: saves an expense. 201 the first time; 200 with
 * `replayed: true` when the same clientId comes again, with nothing added.
 */
export async function POST(request: Request) {
    const auth = await requireCaller(request);
    if (!auth.ok) return auth.response;
    const body = await readV1Body(request, NewExpense);
    if (!body.ok) return body.response;
    try {
        const outcome = await saveExpense(auth.caller.userId, body.data);
        if (!outcome.ok) return v1Error(outcome.error, outcome.status, outcome.code);
        return v1Json(outcome.value, outcome.value.replayed ? 200 : 201);
    } catch (error) {
        logger.error('Phone expense save failed', { err: error });
        return v1Error('Couldn’t save that expense. It’s kept on your phone and will be sent again.', 500, 'server_error');
    }
}
