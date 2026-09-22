import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import bcrypt from 'bcryptjs';
import { passwordProblem } from '@/lib/password';
import { hashSecretToken } from '@/lib/secretTokens';
import { logger } from '@/lib/logger';

class ResetRefused extends Error {}

// POST /api/auth/reset-password — sets a new password with the token from a
// reset email. A token works once: it is deleted in the same transaction that
// changes the password, so two submissions of one link can't both succeed.
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
            await prisma.$transaction(async (tx) => {
                const resetToken = await tx.passwordResetToken.findUnique({ where: { token: tokenHash } });
                const used = await tx.passwordResetToken.deleteMany({
                    where: { token: tokenHash, expires: { gt: new Date() } },
                });
                if (!resetToken || used.count !== 1) throw new ResetRefused();

                const updated = await tx.user.updateMany({
                    where: { email: resetToken.email },
                    data: { password: hashedPassword },
                });
                if (updated.count !== 1) throw new ResetRefused();

                // Any other link for this account stops working too.
                await tx.passwordResetToken.deleteMany({ where: { email: resetToken.email } });
            });
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
