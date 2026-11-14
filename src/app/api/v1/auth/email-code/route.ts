import { readV1Body, v1Error, v1Json } from '@/lib/apiV1';
import { EmailCodeRequest } from '@/lib/contract/v1';
import { logger } from '@/lib/logger';
import { sendEmailCode } from '@/lib/v1/auth';

/**
 * POST /api/v1/auth/email-code: emails a 6-digit code (to sign in, to confirm
 * a new account, or to reset a password). 202 whether or not the address has
 * an account, so the form can't be used to find out.
 */
export async function POST(request: Request) {
    const body = await readV1Body(request, EmailCodeRequest);
    if (!body.ok) return body.response;
    try {
        const outcome = await sendEmailCode(body.data.email, body.data.purpose);
        return outcome.ok ? v1Json(outcome.value, 202) : v1Error(outcome.error, outcome.status, outcome.code);
    } catch (error) {
        logger.error('Phone email code failed', { err: error });
        return v1Error('Couldn’t send a code just now. Try again in a moment.', 500, 'server_error');
    }
}
