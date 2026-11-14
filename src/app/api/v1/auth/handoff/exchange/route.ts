import { meOf, readV1Body, v1Error, v1Json } from '@/lib/apiV1';
import { redeemHandoffCode } from '@/lib/authCodes';
import { HandoffExchange } from '@/lib/contract/v1';
import { logger } from '@/lib/logger';
import { MobileAuthUnavailable, startSession } from '@/lib/mobileAuth';

/**
 * POST /api/v1/auth/handoff/exchange: trades the website's one-time code and
 * the app's PKCE verifier for the app's own session. A code works once, for 2
 * minutes, and only with the verifier of the phone that started the sign-in.
 */
export async function POST(request: Request) {
    const body = await readV1Body(request, HandoffExchange);
    if (!body.ok) return body.response;
    try {
        const userId = await redeemHandoffCode(body.data.code, body.data.verifier);
        if (!userId) return v1Error('That sign-in didn’t finish in time. Try again.', 401, 'handoff_expired');
        const tokens = await startSession(userId, body.data.device);
        const me = await meOf(userId);
        return me ? v1Json({ tokens, me }) : v1Error('That account is gone.', 401, 'handoff_expired');
    } catch (error) {
        if (error instanceof MobileAuthUnavailable) return v1Error('Phone sign-in isn’t switched on yet.', 503, 'sign_in_off');
        logger.error('Phone hand-off exchange failed', { err: error });
        return v1Error('Sign-in didn’t work. Try again.', 500, 'server_error');
    }
}
