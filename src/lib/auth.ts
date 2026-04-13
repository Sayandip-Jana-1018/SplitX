import NextAuth from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import Google from 'next-auth/providers/google';
import GitHub from 'next-auth/providers/github';
import { prisma } from '@/lib/db';
import bcrypt from 'bcryptjs';

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
            async authorize(credentials) {
                if (!credentials?.email || !credentials?.password) return null;

                const user = await prisma.user.findUnique({
                    where: { email: credentials.email as string },
                });

                if (!user || !user.password) return null;

                const isValid = await bcrypt.compare(
                    credentials.password as string,
                    user.password
                );

                if (!isValid) return null;

                return {
                    id: user.id,
                    name: user.name,
                    email: user.email,
                    image: user.image,
                };
            },
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
        /**
         * signIn — Runs on every sign-in (OAuth + Credentials).
         * For OAuth providers, upserts User + Account in the DB so they're
         * always synced, and handles GitHub's missing-email edge case.
         * Includes retry logic for cold DB starts (e.g., Neon auto-suspend).
         */
        async signIn({ user, account, profile }) {
            // Credentials users are already in the DB from /api/register
            if (account?.provider === 'credentials') return true;

            // OAuth flow — sync user + account to the database
            if (account && (account.provider === 'google' || account.provider === 'github')) {
                let email = user.email;

                // GitHub: email may be null if the user has a private email.
                // Fetch it from the GitHub emails API using the access token.
                if (!email && account.provider === 'github' && account.access_token) {
                    try {
                        const res = await fetch('https://api.github.com/user/emails', {
                            headers: {
                                Authorization: `Bearer ${account.access_token}`,
                                Accept: 'application/vnd.github+json',
                            },
                        });
                        if (res.ok) {
                            const emails = await res.json();
                            const primary = emails.find(
                                (e: { primary: boolean; verified: boolean }) =>
                                    e.primary && e.verified
                            );
                            const verified = emails.find(
                                (e: { verified: boolean }) => e.verified
                            );
                            email = primary?.email || verified?.email || emails[0]?.email;
                        }
                    } catch (emailErr) {
                        console.error('Failed to fetch GitHub email:', emailErr);
                    }
                }

                if (!email) {
                    console.error(`OAuth sign-in failed: no email from ${account.provider}`);
                    return false;
                }

                // Retry helper — handles cold DB starts (Neon waking up)
                const MAX_RETRIES = 2;
                const RETRY_DELAY = 500;

                for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
                    try {
                        // Upsert the user (create if new, update name/image if existing)
                        const dbUser = await prisma.user.upsert({
                            where: { email },
                            create: {
                                email,
                                name: user.name || profile?.name as string || null,
                                image: user.image || null,
                                emailVerified: new Date(),
                            },
                            update: {
                                name: user.name || profile?.name as string || undefined,
                                image: user.image || undefined,
                                emailVerified: new Date(),
                            },
                        });

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

                        return true; // Success — DB synced
                    } catch (error) {
                        console.error(`OAuth DB sync attempt ${attempt + 1} failed:`, error);

                        if (attempt < MAX_RETRIES) {
                            // Wait before retrying (DB may be waking up)
                            await new Promise(r => setTimeout(r, RETRY_DELAY * (attempt + 1)));
                        } else {
                            // All retries exhausted — still allow sign-in
                            // JWT session works without DB sync; DB will sync on next sign-in
                            console.warn('OAuth DB sync failed after retries — allowing sign-in anyway');
                            return true;
                        }
                    }
                }
            }

            return true;
        },

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
