import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { sendPasswordResetEmail } from '@/lib/email';
import crypto from 'crypto';

export async function POST(req: Request) {
    try {
        const { email } = await req.json();

        if (!email || typeof email !== 'string') {
            return NextResponse.json({ error: 'Email is required' }, { status: 400 });
        }

        const normalizedEmail = email.toLowerCase().trim();

        // Always return success to prevent user enumeration
        const successResponse = NextResponse.json({
            message: 'If an account exists with that email, we sent a reset link.',
        });

        // Check if user exists with a password (credentials user)
        const user = await prisma.user.findUnique({
            where: { email: normalizedEmail },
            select: { id: true, password: true },
        });

        // If user doesn't exist or is OAuth-only (no password), silently return success
        if (!user || !user.password) {
            return successResponse;
        }

        // Delete any existing reset tokens for this email
        await prisma.passwordResetToken.deleteMany({
            where: { email: normalizedEmail },
        });

        // Generate a secure token
        const token = crypto.randomUUID();

        // Store token with 1hr expiry
        await prisma.passwordResetToken.create({
            data: {
                email: normalizedEmail,
                token,
                expires: new Date(Date.now() + 3600 * 1000), // 1 hour
            },
        });

        // Send the reset email
        await sendPasswordResetEmail(normalizedEmail, token);

        return successResponse;
    } catch (error) {
        console.error('Forgot password error:', error);
        return NextResponse.json(
            { error: 'Something went wrong. Please try again.' },
            { status: 500 }
        );
    }
}
