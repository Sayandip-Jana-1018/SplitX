import { authorizeCredentials, EmailNotConfirmed } from '@/lib/auth';
import { meOf, readV1Body, v1Error, v1Json } from '@/lib/apiV1';
import { PasswordSignIn } from '@/lib/contract/v1';
import { logger } from '@/lib/logger';
import { MobileAuthUnavailable, startSession } from '@/lib/mobileAuth';

/**
 * POST /api/v1/auth/password: the phone signs in with an email and password,
 * by the website's own rules (src/lib/auth.ts: rate limited per account, and
 * an unconfirmed address gets a fresh link instead of a session).
 */
export async function POST(request: Request) {
    const body = await readV1Body(request, PasswordSignIn);
    if (!body.ok) return body.response;
    try {
        const user = await authorizeCredentials({ email: body.data.email, password: body.data.password });
        if (!user?.id) return v1Error('That email and password don’t match an account.', 401, 'bad_credentials');
        const tokens = await startSession(user.id, body.data.device);
        const me = await meOf(user.id);
        if (!me) return v1Error('That account is gone.', 401, 'bad_credentials');
        return v1Json({ tokens, me });
    } catch (error) {
        if (error instanceof EmailNotConfirmed) return v1Error('Confirm your email first. We’ve sent you a fresh link.', 403, 'email_unverified');
        if (error instanceof MobileAuthUnavailable) return v1Error('Phone sign-in isn’t switched on yet.', 503, 'sign_in_off');
        logger.error('Phone password sign-in failed', { err: error });
        return v1Error('Sign-in didn’t work. Try again.', 500, 'server_error');
    }
}
