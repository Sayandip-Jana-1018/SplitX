import { readV1Body, v1Error, v1Json } from '@/lib/apiV1';
import { PasswordResetWithCode } from '@/lib/contract/v1';
import { logger } from '@/lib/logger';
import { MobileAuthUnavailable } from '@/lib/mobileAuth';
import { resetPasswordWithCode } from '@/lib/v1/auth';

/**
 * POST /api/v1/auth/password-reset: sets a new password with an emailed code.
 * Every other session of the account ends; this phone is signed in.
 */
export async function POST(request: Request) {
    const body = await readV1Body(request, PasswordResetWithCode);
    if (!body.ok) return body.response;
    try {
        const outcome = await resetPasswordWithCode(body.data.email, body.data.code, body.data.password, body.data.device);
        return outcome.ok ? v1Json(outcome.value) : v1Error(outcome.error, outcome.status, outcome.code);
    } catch (error) {
        if (error instanceof MobileAuthUnavailable) return v1Error('Phone sign-in isn’t switched on yet.', 503, 'sign_in_off');
        logger.error('Phone password reset failed', { err: error });
        return v1Error('Couldn’t set your new password. Try again.', 500, 'server_error');
    }
}
