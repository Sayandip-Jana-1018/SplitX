import { readV1Body, requireCaller, v1Error, v1Json } from '@/lib/apiV1';
import { InvitationAnswer, type InvitationAnswered } from '@/lib/contract/v1';
import { logger } from '@/lib/logger';
import { answerInvitation } from '@/lib/services/contacts';
import { actorOf } from '@/lib/v1/contacts';

/** POST /api/v1/invitations/:id: your answer; accepting puts you in the group. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const auth = await requireCaller(request);
    if (!auth.ok) return auth.response;
    const body = await readV1Body(request, InvitationAnswer);
    if (!body.ok) return body.response;
    const { id } = await params;
    try {
        const actor = await actorOf(auth.caller.userId);
        if (!actor) return v1Error('Your session has ended. Sign in again.', 401, 'unauthenticated');
        const outcome = await answerInvitation(actor, id, body.data.accept ? 'accepted' : 'declined');
        if (!outcome.ok) return v1Error(outcome.error, outcome.status, outcome.code);
        const answer: InvitationAnswered = { status: outcome.value.status, groupId: outcome.value.groupId ?? null };
        return v1Json(answer);
    } catch (error) {
        logger.error('Phone invitation answer failed', { err: error });
        return v1Error('Couldn’t answer that. Try again.', 500, 'server_error');
    }
}
