import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { normalizeEmail } from '@/lib/password';
import { sendVerificationLink, verificationRequired } from '@/lib/emailVerification';
import { logger } from '@/lib/logger';

// POST /api/auth/resend-verification — a new confirmation link for an account
// that is waiting for one. The answer is the same for every address.
export async function POST(req: Request) {
    try {
        const body = await req.json().catch(() => null) as { email?: unknown } | null;
        const email = typeof body?.email === 'string' ? normalizeEmail(body.email) : '';
        if (!email || email.length > 254) {
            return NextResponse.json({ error: 'Email is required' }, { status: 400 });
        }

        if (verificationRequired()) {
            const user = await prisma.user.findFirst({
                where: { email: { equals: email, mode: 'insensitive' } },
                select: { email: true, password: true, emailVerified: true },
            });
            if (user?.email && user.password && !user.emailVerified) {
                await sendVerificationLink(normalizeEmail(user.email));
            }
        }

        return NextResponse.json({ message: 'If that address is waiting to be confirmed, we sent a new link.' });
    } catch (error) {
        logger.error('Resend confirmation error', { err: error });
        return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
    }
}
