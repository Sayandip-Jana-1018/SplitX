import { readV1Body, requireCaller, v1Error, v1Json } from '@/lib/apiV1';
import { ContactInviteRequest, type ContactInviteLink } from '@/lib/contract/v1';
import { logger } from '@/lib/logger';
import { contactInvite } from '@/lib/services/contacts';
import { siteUrl } from '@/lib/siteUrl';

/** POST /api/v1/contacts/:id/invite: a link and message to send them yourself, to sign up or to join a group of yours. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const auth = await requireCaller(request);
    if (!auth.ok) return auth.response;
    const body = await readV1Body(request, ContactInviteRequest);
    if (!body.ok) return body.response;
    const { id } = await params;
    try {
        const outcome = await contactInvite(auth.caller.userId, id, body.data.groupId, siteUrl(request) ?? new URL(request.url).origin);
        if (!outcome.ok) return v1Error(outcome.error, outcome.status, outcome.code);
        const answer: ContactInviteLink = { url: outcome.value.url, message: outcome.value.message };
        return v1Json(answer);
    } catch (error) {
        logger.error('Phone contact invite failed', { err: error });
        return v1Error('Couldn’t make the link. Try again.', 500, 'server_error');
    }
}
