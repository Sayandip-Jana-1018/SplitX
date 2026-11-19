import { NextResponse } from 'next/server';
import { readV1Body, requireCaller, v1Error, v1Json } from '@/lib/apiV1';
import { GroupInvitationRequest, type InvitationList } from '@/lib/contract/v1';
import { logger } from '@/lib/logger';
import { inviteToGroup, pendingInvitations } from '@/lib/services/contacts';
import { actorOf, invitationOf } from '@/lib/v1/contacts';

/** GET /api/v1/invitations: invitations into groups, waiting for your answer. */
export async function GET(request: Request) {
    const auth = await requireCaller(request);
    if (!auth.ok) return auth.response;
    try {
        const answer: InvitationList = { invitations: (await pendingInvitations(auth.caller.userId)).map(invitationOf) };
        return v1Json(answer);
    } catch (error) {
        logger.error('Phone invitations read failed', { err: error });
        return v1Error('Couldn’t load your invitations. Try again.', 500, 'server_error');
    }
}

/** POST /api/v1/invitations: invites someone with an account into a group you're in; they're told. */
export async function POST(request: Request) {
    const auth = await requireCaller(request);
    if (!auth.ok) return auth.response;
    const body = await readV1Body(request, GroupInvitationRequest);
    if (!body.ok) return body.response;
    try {
        const actor = await actorOf(auth.caller.userId);
        if (!actor) return v1Error('Your session has ended. Sign in again.', 401, 'unauthenticated');
        const outcome = await inviteToGroup(actor, body.data.groupId, body.data.inviteeId);
        return outcome.ok ? new NextResponse(null, { status: 204 }) : v1Error(outcome.error, outcome.status, outcome.code);
    } catch (error) {
        logger.error('Phone group invitation failed', { err: error });
        return v1Error('Couldn’t send the invitation. Try again.', 500, 'server_error');
    }
}
