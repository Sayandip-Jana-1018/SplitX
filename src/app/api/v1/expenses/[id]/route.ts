import { NextResponse } from 'next/server';
import { requireCaller, v1Error } from '@/lib/apiV1';
import { logger } from '@/lib/logger';
import { removeExpense } from '@/lib/v1/writes';

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
