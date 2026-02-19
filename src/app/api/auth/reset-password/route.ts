import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import bcrypt from 'bcryptjs';

export async function POST(req: Request) {
    try {
        const { token, password } = await req.json();

        if (!token || typeof token !== 'string') {
            return NextResponse.json({ error: 'Invalid reset link' }, { status: 400 });
        }

        if (!password || typeof password !== 'string' || password.length < 6) {
            return NextResponse.json(
                { error: 'Password must be at least 6 characters' },
                { status: 400 }
            );
        }

        // Find the token
        const resetToken = await prisma.passwordResetToken.findUnique({
            where: { token },
        });

        if (!resetToken) {
            return NextResponse.json(
                { error: 'Invalid or expired reset link. Please request a new one.' },
                { status: 400 }
            );
        }

        // Check expiry
        if (new Date() > resetToken.expires) {
            // Clean up expired token
            await prisma.passwordResetToken.delete({ where: { id: resetToken.id } });
            return NextResponse.json(
                { error: 'This reset link has expired. Please request a new one.' },
                { status: 400 }
            );
        }

        // Hash the new password
        const hashedPassword = await bcrypt.hash(password, 12);

        // Update user password
        await prisma.user.update({
            where: { email: resetToken.email },
            data: { password: hashedPassword },
        });

        // Delete all reset tokens for this email (cleanup)
        await prisma.passwordResetToken.deleteMany({
            where: { email: resetToken.email },
        });

        return NextResponse.json({ message: 'Password reset successfully!' });
    } catch (error) {
        console.error('Reset password error:', error);
        return NextResponse.json(
            { error: 'Something went wrong. Please try again.' },
            { status: 500 }
        );
    }
}
