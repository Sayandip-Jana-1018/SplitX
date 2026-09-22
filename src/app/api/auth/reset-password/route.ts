import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import bcrypt from 'bcryptjs';
import { passwordProblem } from '@/lib/password';
import { hashSecretToken } from '@/lib/secretTokens';
import { forgetTokenVersion } from '@/lib/sessionVersion';
import { logger } from '@/lib/logger';

class ResetRefused extends Error {}

// POST /api/auth/reset-password — sets a new password with the token from a
// reset email. A token works once: it is deleted in the same transaction that
// changes the password, so two submissions of one link can't both succeed.
// A reset is what someone does when they think the old password leaked, so it
// also ends every session of the account (src/lib/sessionVersion.ts).
export async function POST(req: Request) {
    try {
        const body = await req.json().catch(() => null) as { token?: unknown; password?: unknown } | null;
        const token = typeof body?.token === 'string' ? body.token : '';
        const password = typeof body?.password === 'string' ? body.password : '';

        if (!token || token.length > 200) {
            return NextResponse.json({ error: 'Invalid reset link' }, { status: 400 });
        }
        const problem = passwordProblem(password);
        if (problem) {
            return NextResponse.json({ error: problem }, { status: 400 });
        }

        const tokenHash = hashSecretToken(token);
        const hashedPassword = await bcrypt.hash(password, 12);

        try {
            const userId = await prisma.$transaction(async (tx) => {
                const resetToken = await tx.passwordResetToken.findUnique({ where: { token: tokenHash } });
                const used = await tx.passwordResetToken.deleteMany({
                    where: { token: tokenHash, expires: { gt: new Date() } },
                });
                if (!resetToken || used.count !== 1) throw new ResetRefused();

                const account = await tx.user.findUnique({ where: { email: resetToken.email }, select: { id: true } });
                if (!account) throw new ResetRefused();

                await tx.user.update({
                    where: { id: account.id },
                    data: { password: hashedPassword, tokenVersion: { increment: 1 } },
                });
                // The link arrived at the address, so the address is theirs.
                await tx.user.updateMany({
                    where: { id: account.id, emailVerified: null },
                    data: { emailVerified: new Date() },
                });

                // Any other link for this account stops working too.
                await tx.passwordResetToken.deleteMany({ where: { email: resetToken.email } });
                return account.id;
            });
            forgetTokenVersion(userId);
        } catch (error) {
            if (error instanceof ResetRefused) {
                return NextResponse.json(
                    { error: 'Invalid or expired reset link. Please request a new one.' },
                    { status: 400 }
                );
            }
            throw error;
        }

        return NextResponse.json({ message: 'Password reset successfully!' });
    } catch (error) {
        logger.error('Reset password error', { err: error });
        return NextResponse.json(
            { error: 'Something went wrong. Please try again.' },
            { status: 500 }
        );
    }
}
