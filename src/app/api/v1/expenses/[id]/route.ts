import { NextResponse } from 'next/server';
import { readV1Body, requireCaller, v1Error, v1Json } from '@/lib/apiV1';
import { ExpenseEdit } from '@/lib/contract/v1';
import { logger } from '@/lib/logger';
import { editExpense, removeExpense } from '@/lib/v1/writes';

/** DELETE /api/v1/expenses/:id: deletes an expense you paid, or one in a group you own. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const auth = await requireCaller(request);
    if (!auth.ok) return auth.response;
    const { id } = await params;
    try {
        const outcome = await removeExpense(auth.caller.userId, id);
        return outcome.ok ? new NextResponse(null, { status: 204 }) : v1Error(outcome.error, outcome.status, outcome.code);
    } catch (error) {
        logger.error('Phone expense delete failed', { err: error });
        return v1Error('Couldn’t delete that expense. Try again.', 500, 'server_error');
    }
}

/**
 * PATCH /api/v1/expenses/:id: edits an expense you paid, or one in a group you own, by the
 * website's rules. Only what's sent changes; an edit to an older copy is refused (409, "conflict").
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const auth = await requireCaller(request);
    if (!auth.ok) return auth.response;
    const body = await readV1Body(request, ExpenseEdit);
    if (!body.ok) return body.response;
    const { id } = await params;
    try {
        const outcome = await editExpense(auth.caller.userId, id, body.data);
        return outcome.ok ? v1Json(outcome.value) : v1Error(outcome.error, outcome.status, outcome.code);
    } catch (error) {
        logger.error('Phone expense edit failed', { err: error });
        return v1Error('Couldn’t save that change. Try again.', 500, 'server_error');
    }
}
