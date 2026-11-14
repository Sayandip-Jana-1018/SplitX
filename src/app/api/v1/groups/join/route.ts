import { readV1Body, requireCaller, v1Error, v1Json } from '@/lib/apiV1';
import { JoinGroup } from '@/lib/contract/v1';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import { joinGroup } from '@/lib/services/groups';

/**
 * POST /api/v1/groups/join: joins by invite code. 201 when you joined, 200 with
 * `joined: false` when you were already in, 404 for a code that never was, 410
 * for an expired one.
 */
export async function POST(request: Request) {
    const auth = await requireCaller(request);
    if (!auth.ok) return auth.response;
    const body = await readV1Body(request, JoinGroup);
    if (!body.ok) return body.response;
    try {
        const user = await prisma.user.findUnique({ where: { id: auth.caller.userId }, select: { id: true, name: true, email: true } });
        if (!user) return v1Error('Sign in to continue.', 401, 'signed_out');
        const outcome = await joinGroup(user, body.data.inviteCode);
        if (!outcome.ok) return v1Error(outcome.error, outcome.status, outcome.code);
        return v1Json(outcome.value, outcome.value.joined ? 201 : 200);
    } catch (error) {
        logger.error('Phone group join failed', { err: error });
        return v1Error('Couldn’t join the group. Try again.', 500, 'server_error');
    }
}
