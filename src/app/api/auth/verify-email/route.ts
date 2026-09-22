import { NextResponse } from 'next/server';
import { confirmEmail } from '@/lib/emailVerification';
import { logger } from '@/lib/logger';

// POST /api/auth/verify-email — uses the link from a confirmation email.
export async function POST(req: Request) {
    try {
        const body = await req.json().catch(() => null) as { token?: unknown } | null;
        const token = typeof body?.token === 'string' ? body.token : '';
        if (!token || token.length > 200 || !(await confirmEmail(token))) {
            return NextResponse.json(
                { error: 'This link is invalid or has expired. Sign in with your password and we’ll send a new one.' },
                { status: 400 }
            );
        }
        return NextResponse.json({ verified: true });
    } catch (error) {
        logger.error('Email confirmation error', { err: error });
        return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
    }
}
