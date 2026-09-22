import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { emailTransport, sendPasswordResetEmail } from '@/lib/email';
import { normalizeEmail } from '@/lib/password';
import { hashSecretToken, newSecretToken } from '@/lib/secretTokens';
import { consumeAllowance } from '@/lib/rateLimit';
import { logger } from '@/lib/logger';

const RESET_LINK_MS = 60 * 60 * 1000;
/**
 * Reset emails per account per hour. The limit in front of this route is per
 * device (B-025), loose enough for a classroom signing in at once, so it can't
 * also be what keeps one person's inbox from being flooded.
 */
const RESET_MAILS_PER_HOUR = 3;

// POST /api/auth/forgot-password — emails a reset link to an account that has a
// password. The answer is the same whether or not the account exists.
export async function POST(req: Request) {
    try {
        const body = await req.json().catch(() => null) as { email?: unknown } | null;
        const email = typeof body?.email === 'string' ? normalizeEmail(body.email) : '';
        if (!email || email.length > 254) {
            return NextResponse.json({ error: 'Email is required' }, { status: 400 });
        }

        // Without a sender, say so: a "we sent a link" that never arrives is worse.
        if (!emailTransport()) {
            return NextResponse.json(
                { error: 'Password reset by email isn’t available right now. Sign in with Google or GitHub if your account uses them.' },
                { status: 503 }
            );
        }

        const successResponse = NextResponse.json({
            message: 'If an account exists with that email, we sent a reset link.',
        });

        const user = await prisma.user.findFirst({
            where: { email: { equals: email, mode: 'insensitive' } },
            select: { id: true, email: true, password: true },
        });

        // No account, or one that signs in with Google or GitHub only.
        if (!user?.email || !user.password) {
            return successResponse;
        }

        // Past the account's allowance nothing is sent, and the answer is the same.
        const recent = await consumeAllowance(`reset-mail:${user.email.toLowerCase()}`, RESET_MAILS_PER_HOUR, 60 * 60 * 1000);
        if (recent.outcome === 'deny') {
            return successResponse;
        }

        // One live link per account: a new request replaces the old one. The
        // database keeps the token's hash; the email carries the token.
        const token = newSecretToken();
        await prisma.$transaction([
            prisma.passwordResetToken.deleteMany({ where: { email: user.email } }),
            prisma.passwordResetToken.create({
                data: { email: user.email, token: hashSecretToken(token), expires: new Date(Date.now() + RESET_LINK_MS) },
            }),
        ]);

        await sendPasswordResetEmail(user.email, token);

        return successResponse;
    } catch (error) {
        logger.error('Forgot password error', { err: error });
        return NextResponse.json(
            { error: 'Something went wrong. Please try again.' },
            { status: 500 }
        );
    }
}
