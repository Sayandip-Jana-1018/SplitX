import { requireCaller, v1Error, v1Json } from '@/lib/apiV1';
import { logger } from '@/lib/logger';
import { inviteLink } from '@/lib/services/groups';

/**
 * POST /api/v1/groups/:groupId/invite: a link to share. The one already out is
 * kept while it works (unlike the website's "Make a new link"); an expired one
 * is renewed. 404 for a group you aren't in.
 */
export async function POST(request: Request, { params }: { params: Promise<{ groupId: string }> }) {
    const auth = await requireCaller(request);
    if (!auth.ok) return auth.response;
    const { groupId } = await params;
    try {
        const link = await inviteLink(auth.caller.userId, groupId, { adminMakesNew: false });
        if (!link) return v1Error('That group isn’t one of yours.', 404, 'not_found');
        return v1Json({ inviteCode: link.inviteCode, url: `${new URL(request.url).origin}/join/${link.inviteCode}`, expiresAt: link.inviteExpiresAt.toISOString() });
    } catch (error) {
        logger.error('Phone invite link failed', { err: error });
        return v1Error('Couldn’t get a link. Try again.', 500, 'server_error');
    }
}
