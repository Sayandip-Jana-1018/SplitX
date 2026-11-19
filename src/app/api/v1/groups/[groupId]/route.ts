import { NextResponse } from 'next/server';
import { requireCaller, v1Error, v1Json } from '@/lib/apiV1';
import { logger } from '@/lib/logger';
import { groupDetail } from '@/lib/v1/reads';
import { deleteGroupAs } from '@/lib/v1/writes';

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

/**
 * DELETE /api/v1/groups/:groupId: the owner deletes a group once everyone in it is square
 * (409 "not_settled" until then), by the website's rules.
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ groupId: string }> }) {
    const auth = await requireCaller(request);
    if (!auth.ok) return auth.response;
    const { groupId } = await params;
    try {
        const outcome = await deleteGroupAs(auth.caller.userId, groupId);
        return outcome.ok ? new NextResponse(null, { status: 204 }) : v1Error(outcome.error, outcome.status, outcome.code);
    } catch (error) {
        logger.error('Phone group delete failed', { err: error });
        return v1Error('Couldn’t delete that group. Try again.', 500, 'server_error');
    }
}
