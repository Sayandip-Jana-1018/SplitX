import { readV1Body, v1Error, v1Json } from '@/lib/apiV1';
import { EmailCodeSignIn } from '@/lib/contract/v1';
import { logger } from '@/lib/logger';
import { MobileAuthUnavailable } from '@/lib/mobileAuth';
import { signInWithEmailCode } from '@/lib/v1/auth';

/** POST /api/v1/auth/email-code/verify: signs in with an emailed code; `isNew` when the account has no name yet. */
export async function POST(request: Request) {
    const body = await readV1Body(request, EmailCodeSignIn);
    if (!body.ok) return body.response;
    try {
        const outcome = await signInWithEmailCode(body.data.email, body.data.code, body.data.purpose, body.data.device);
        return outcome.ok ? v1Json(outcome.value) : v1Error(outcome.error, outcome.status, outcome.code);
    } catch (error) {
        if (error instanceof MobileAuthUnavailable) return v1Error('Phone sign-in isn’t switched on yet.', 503, 'sign_in_off');
        logger.error('Phone email code sign-in failed', { err: error });
        return v1Error('Sign-in didn’t work. Try again.', 500, 'server_error');
    }
}
