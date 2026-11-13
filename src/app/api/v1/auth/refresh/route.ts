import { readV1Body, v1Error, v1Json } from '@/lib/apiV1';
import { RefreshRequest } from '@/lib/contract/v1';
import { logger } from '@/lib/logger';
import { MobileAuthUnavailable, rotateRefreshToken } from '@/lib/mobileAuth';

const ENDED: Record<string, string> = {
    invalid: 'Your session has ended. Sign in again.',
    expired: 'You haven’t opened SplitIT in a while. Sign in again.',
    reused: 'For your safety this session was ended. Sign in again.',
    ended: 'Your session was ended. Sign in again.',
};

/**
 * POST /api/v1/auth/refresh: trades a refresh token for a new pair. Any refusal
 * is a 401 whose code (invalid, expired, reused, ended) the app turns into
 * "sign in again".
 */
export async function POST(request: Request) {
    const body = await readV1Body(request, RefreshRequest);
    if (!body.ok) return body.response;
    try {
        const outcome = await rotateRefreshToken(body.data.refreshToken);
        if (!outcome.ok) {
            if (outcome.reason === 'reused') logger.warn('A used phone refresh token came back; its family was revoked');
            return v1Error(ENDED[outcome.reason], 401, outcome.reason);
        }
        return v1Json({ tokens: outcome.tokens });
    } catch (error) {
        if (error instanceof MobileAuthUnavailable) return v1Error('Phone sign-in isn’t switched on yet.', 503, 'sign_in_off');
        logger.error('Phone token refresh failed', { err: error });
        return v1Error('Couldn’t refresh your session. Try again.', 500, 'server_error');
    }
}
