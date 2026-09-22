import NextAuth, { CredentialsSignin } from 'next-auth';
import type { Account, Profile, User } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import Google from 'next-auth/providers/google';
import GitHub from 'next-auth/providers/github';
import { prisma } from '@/lib/db';
import bcrypt from 'bcryptjs';
import { normalizeEmail } from '@/lib/password';
import { consumeAllowance } from '@/lib/rateLimit';
import { sendVerificationLink, verificationRequired } from '@/lib/emailVerification';
import { logger } from '@/lib/logger';

const LOGIN_ATTEMPTS = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

/** The sign-in page reads this code and asks the person to open the link we sent. */
export class EmailNotConfirmed extends CredentialsSignin {
    code = 'email_unverified';
}

/**
 * The address a provider vouches for, or null. Google says whether it verified
 * the address; for GitHub, the account's primary address is used if it is
 * verified, otherwise any verified one, and never an unverified one.
 */
export async function verifiedProviderEmail(
    account: Pick<Account, 'provider' | 'access_token'>,
    profile: Profile | undefined,
    profileEmail: string | null | undefined
): Promise<string | null> {
    if (account.provider === 'google') {
        return profile?.email_verified === true && profileEmail ? normalizeEmail(profileEmail) : null;
    }
    if (account.provider === 'github' && account.access_token) {
        try {
            const res = await fetch('https://api.github.com/user/emails', {
                headers: { Authorization: `Bearer ${account.access_token}`, Accept: 'application/vnd.github+json' },
                signal: AbortSignal.timeout(10_000),
            });
            if (!res.ok) return null;
            const emails = await res.json() as { email: string; primary: boolean; verified: boolean }[];
            const chosen = emails.find((entry) => entry.primary && entry.verified) ?? emails.find((entry) => entry.verified);
            return chosen ? normalizeEmail(chosen.email) : null;
        } catch (error) {
            logger.error('Failed to fetch GitHub email', { err: error });
            return null;
        }
    }
    return null;
}

/** Checks an email and password: the user, or null. */
export async function authorizeCredentials(credentials: Partial<Record<'email' | 'password', unknown>> | undefined) {
    if (typeof credentials?.email !== 'string' || typeof credentials?.password !== 'string') return null;
    const email = normalizeEmail(credentials.email);
    if (!email || email.length > 254 || credentials.password.length > 1_000) return null;

    // Ten tries per account per 15 minutes, wherever they come from: the
    // per-address limit alone lets a password be guessed from many addresses.
    // If the counter is unreachable, the per-address limit still applies.
    const attempts = await consumeAllowance(`login:${email}`, LOGIN_ATTEMPTS, LOGIN_WINDOW_MS);
    if (attempts.outcome === 'deny') {
        logger.warn('Sign-in refused: too many attempts for one account');
        return null;
    }

    // Registration stores addresses in lower case; accounts made by Google or
    // GitHub may not, so the match ignores case.
    const user = await prisma.user.findFirst({
        where: { email: { equals: email, mode: 'insensitive' } },
    });
    if (!user || !user.password) return null;

    if (!(await bcrypt.compare(credentials.password, user.password))) return null;

    // Only someone who knows the password learns the address is unconfirmed,
    // and they get a fresh link (at most one every ten minutes).
    if (!user.emailVerified && user.email && verificationRequired()) {
        try {
            await sendVerificationLink(normalizeEmail(user.email));
        } catch (error) {
            logger.error('Could not send the confirmation email', { err: error });
        }
        throw new EmailNotConfirmed();
    }

    return {
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
    };
}

/**
 * Runs on every sign-in. A Google or GitHub sign-in is tied to a SplitX account
 * by email, and only by an email the provider has verified: GitHub used to fall
 * back to the first address on the account, verified or not, which let someone
 * claim another person's account.
 *
 * When a verified identity arrives for an account whose password was set
 * before anyone proved they own the address, that password is removed: it may
 * have been set by someone who registered with another person's email first.
 * The owner signs in with the provider, or resets the password by email.
 *
 * Retries cover cold database starts (Neon waking up).
 */
export async function syncOAuthSignIn({ user, account, profile }: { user: User; account?: Account | null; profile?: Profile }) {
    // Credentials users are already in the DB from /api/register
    if (!account || account.provider === 'credentials') return true;
    if (account.provider !== 'google' && account.provider !== 'github') return true;

    const email = await verifiedProviderEmail(account, profile, user.email);
    if (!email) {
        logger.warn('OAuth sign-in refused: the provider gave no verified email', { provider: account.provider });
        return false;
    }

    const MAX_RETRIES = 2;
    const RETRY_DELAY = 500;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            const providerName = user.name || (profile?.name as string | undefined) || null;
            const existing = await prisma.user.findFirst({
                where: { email: { equals: email, mode: 'insensitive' } },
                select: { id: true, name: true, image: true, password: true, emailVerified: true },
            });
            const unprovenPassword = Boolean(existing?.password && !existing.emailVerified);

            // A name or photo the person set themselves is kept.
            const dbUser = existing
                ? await prisma.user.update({
                    where: { id: existing.id },
                    data: {
                        ...(existing.name ? {} : { name: providerName }),
                        ...(existing.image ? {} : { image: user.image || null }),
                        emailVerified: new Date(),
                        ...(unprovenPassword ? { password: null } : {}),
                    },
                })
                : await prisma.user.create({
                    data: { email, name: providerName, image: user.image || null, emailVerified: new Date() },
                });
            if (unprovenPassword) {
                logger.warn('Removed a password set before the address was verified', { provider: account.provider });
            }

            // Upsert the Account link (provider + providerAccountId)
            await prisma.account.upsert({
                where: {
                    provider_providerAccountId: {
                        provider: account.provider,
                        providerAccountId: account.providerAccountId,
                    },
                },
                create: {
                    userId: dbUser.id,
                    type: account.type,
                    provider: account.provider,
                    providerAccountId: account.providerAccountId,
                    access_token: account.access_token,
                    refresh_token: account.refresh_token,
                    expires_at: account.expires_at,
                    token_type: account.token_type,
                    scope: account.scope,
                    id_token: account.id_token,
                },
                update: {
                    access_token: account.access_token,
                    refresh_token: account.refresh_token,
                    expires_at: account.expires_at,
                    token_type: account.token_type,
                    scope: account.scope,
                    id_token: account.id_token,
                },
            });

            // Attach the DB user ID so the jwt callback picks it up
            user.id = dbUser.id;
            user.email = email;
            return true;
        } catch (error) {
            logger.error('OAuth database sync attempt failed', { attempt: attempt + 1, err: error });
            if (attempt < MAX_RETRIES) {
                await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY * (attempt + 1)));
            } else {
                // The session works without the sync; the next sign-in syncs.
                logger.warn('OAuth database sync failed after retries; allowing sign-in');
                return true;
            }
        }
    }
    return true;
}

const oauthProviders = [];

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    oauthProviders.push(
        Google({
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        })
    );
}

if (process.env.GITHUB_ID && process.env.GITHUB_SECRET) {
    oauthProviders.push(
        GitHub({
            clientId: process.env.GITHUB_ID,
            clientSecret: process.env.GITHUB_SECRET,
            // Request email scope explicitly — GitHub doesn't always provide it
            authorization: {
                params: { scope: 'read:user user:email' },
            },
        })
    );
}

export const { handlers, signIn, signOut, auth } = NextAuth({
    providers: [
        ...oauthProviders,
        CredentialsProvider({
            name: 'credentials',
            credentials: {
                email: { label: 'Email', type: 'email' },
                password: { label: 'Password', type: 'password' },
            },
            authorize: (credentials) => authorizeCredentials(credentials),
        }),
    ],
    session: {
        strategy: 'jwt',
        maxAge: 30 * 24 * 60 * 60, // 30 days — keep users logged in
    },
    trustHost: true, // Required for Vercel / reverse-proxy deployments
    cookies: {
        sessionToken: {
            name: process.env.NODE_ENV === 'production'
                ? '__Secure-authjs.session-token'
                : 'authjs.session-token',
            options: {
                httpOnly: true,
                sameSite: 'lax',
                path: '/',
                maxAge: 30 * 24 * 60 * 60, // 30 days
                secure: process.env.NODE_ENV === 'production',
            },
        },
    },
    pages: {
        signIn: '/login',
        newUser: '/register',
    },
    callbacks: {
        signIn: ({ user, account, profile }) => syncOAuthSignIn({ user, account, profile }),

        async jwt({ token, user }) {
            if (user) {
                token.id = user.id;
                token.email = user.email;
            }
            return token;
        },

        async session({ session, token }) {
            if (session.user && token.id) {
                session.user.id = token.id as string;
            }
            return session;
        },
    },
});
