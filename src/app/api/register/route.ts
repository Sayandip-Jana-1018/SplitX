import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import bcrypt from 'bcryptjs';
import { registerSchema } from '@/lib/validators';
import { normalizeEmail } from '@/lib/password';
import { noticeRepeatSignUp, sendVerificationLink, verificationRequired } from '@/lib/emailVerification';
import { logger } from '@/lib/logger';

const CHECK_INBOX = 'Check your email: we sent a link to confirm your address.';

// POST /api/register — opens a password account.
//
// While SplitX can send email, the address must be confirmed before the
// account can sign in (lib/emailVerification.ts), and the answer is the same
// whether or not the address already has an account: its owner gets an email
// instead. Without email, a taken address is refused as before.
export async function POST(req: Request) {
    try {
        const result = registerSchema.safeParse(await req.json().catch(() => null));

        if (!result.success) {
            return NextResponse.json(
                { error: result.error.issues[0].message },
                { status: 400 }
            );
        }

        const { name, password } = result.data;
        const email = normalizeEmail(result.data.email);
        const mustConfirm = verificationRequired();

        // Hashed before the lookup, so the time taken doesn't reveal whether
        // the address has an account.
        const hashedPassword = await bcrypt.hash(password, 12);

        const alreadyRegistered = async () => {
            if (!mustConfirm) {
                return NextResponse.json({ error: 'An account with this email already exists' }, { status: 409 });
            }
            try {
                await noticeRepeatSignUp(email);
            } catch (error) {
                logger.error('Could not email the owner of an address that signed up again', { err: error });
            }
            return NextResponse.json({ message: CHECK_INBOX, verificationSent: true }, { status: 201 });
        };

        // Compared without case: accounts made by Google or GitHub may carry
        // the address in the case the provider gave it.
        const existingUser = await prisma.user.findFirst({
            where: { email: { equals: email, mode: 'insensitive' } },
            select: { id: true },
        });
        if (existingUser) return alreadyRegistered();

        let user;
        try {
            user = await prisma.user.create({
                data: { name, email, password: hashedPassword },
                select: { id: true, name: true, email: true },
            });
        } catch (error) {
            // Two sign-ups with one address at the same moment: the second is the repeat.
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return alreadyRegistered();
            throw error;
        }

        if (mustConfirm) {
            try {
                await sendVerificationLink(email);
            } catch (error) {
                // The account exists; signing in sends a new link.
                logger.error('Could not send the confirmation email', { err: error });
            }
            return NextResponse.json({ message: CHECK_INBOX, verificationSent: true }, { status: 201 });
        }

        return NextResponse.json(
            { message: 'Account created successfully', user, verificationSent: false },
            { status: 201 }
        );
    } catch (error) {
        logger.error('Registration error', { err: error });
        return NextResponse.json(
            { error: 'Something went wrong. Please try again.' },
            { status: 500 }
        );
    }
}
