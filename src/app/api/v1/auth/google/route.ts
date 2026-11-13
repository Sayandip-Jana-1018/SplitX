import type { Account, Profile, User } from 'next-auth';
import { syncOAuthSignIn } from '@/lib/auth';
import { meOf, readV1Body, v1Error, v1Json } from '@/lib/apiV1';
import { GoogleSignIn } from '@/lib/contract/v1';
import { logger } from '@/lib/logger';
import { MobileAuthUnavailable, startSession, verifyGoogleIdToken } from '@/lib/mobileAuth';

/**
 * POST /api/v1/auth/google: the phone signs in with the ID token native
 * Google sign-in gave it. The token is checked against Google's keys, then the
 * account is found or made by the website's own rule (syncOAuthSignIn): by a
 * verified email only, removing a password nobody proved they own.
 */
export async function POST(request: Request) {
    const body = await readV1Body(request, GoogleSignIn);
    if (!body.ok) return body.response;
    try {
        const identity = await verifyGoogleIdToken(body.data.idToken);
        if (!identity) return v1Error('Google didn’t vouch for that sign-in. Try again.', 401, 'bad_google_token');
        if (!identity.emailVerified) return v1Error('Google hasn’t verified that email address.', 403, 'email_unverified');

        const user: User = { email: identity.email, name: identity.name, image: identity.picture };
        const account = { provider: 'google', type: 'oidc', providerAccountId: identity.subject } as Account;
        const profile = { email_verified: true, name: identity.name } as Profile;
        const allowed = await syncOAuthSignIn({ user, account, profile });
        if (!allowed) return v1Error('Google didn’t give a verified email address.', 403, 'email_unverified');
        // The account couldn't be saved just now (a cold database): the website lets that through, the phone can't.
        if (!user.id) return v1Error('Sign-in didn’t finish. Try again in a moment.', 503, 'try_again');

        const tokens = await startSession(user.id, body.data.device);
        const me = await meOf(user.id);
        if (!me) return v1Error('Sign-in didn’t finish. Try again in a moment.', 503, 'try_again');
        return v1Json({ tokens, me });
    } catch (error) {
        if (error instanceof MobileAuthUnavailable) return v1Error('Phone sign-in isn’t switched on yet.', 503, 'sign_in_off');
        logger.error('Phone Google sign-in failed', { err: error });
        return v1Error('Sign-in didn’t work. Try again.', 500, 'server_error');
    }
}
