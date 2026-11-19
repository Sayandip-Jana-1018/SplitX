import { NextResponse } from 'next/server';
import { requireCaller, v1Error } from '@/lib/apiV1';
import { logger } from '@/lib/logger';
import { removeFromGroup } from '@/lib/v1/writes';

/**
 * DELETE /api/v1/groups/:groupId/members/:userId: the owner or an admin removes someone who is
 * square in the group (409 until they are), by the website's rules.
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ groupId: string; userId: string }> }) {
    const auth = await requireCaller(request);
    if (!auth.ok) return auth.response;
    const { groupId, userId } = await params;
    try {
        const outcome = await removeFromGroup(auth.caller.userId, groupId, userId);
        return outcome.ok ? new NextResponse(null, { status: 204 }) : v1Error(outcome.error, outcome.status, outcome.code);
    } catch (error) {
        logger.error('Phone member removal failed', { err: error });
        return v1Error('Couldn’t remove them. Try again.', 500, 'server_error');
    }
}
