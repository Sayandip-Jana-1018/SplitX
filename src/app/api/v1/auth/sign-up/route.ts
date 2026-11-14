import { readV1Body, v1Error, v1Json } from '@/lib/apiV1';
import { SignUp } from '@/lib/contract/v1';
import { logger } from '@/lib/logger';
import { MobileAuthUnavailable } from '@/lib/mobileAuth';
import { signUp } from '@/lib/v1/auth';

/**
 * POST /api/v1/auth/sign-up: creates an account with a password. 201 with
 * `codeSent` while the address must be confirmed (then email-code/verify with
 * confirm_sign_up), or with a session when there's nothing to confirm.
 */
export async function POST(request: Request) {
    const body = await readV1Body(request, SignUp);
    if (!body.ok) return body.response;
    try {
        const outcome = await signUp(body.data.name, body.data.email, body.data.password, body.data.device);
        return outcome.ok ? v1Json(outcome.value, 201) : v1Error(outcome.error, outcome.status, outcome.code);
    } catch (error) {
        if (error instanceof MobileAuthUnavailable) return v1Error('Phone sign-in isn’t switched on yet.', 503, 'sign_in_off');
        logger.error('Phone sign-up failed', { err: error });
        return v1Error('Couldn’t create your account. Try again.', 500, 'server_error');
    }
}
