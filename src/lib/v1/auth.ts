import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { meOf } from '@/lib/apiV1';
import { checkEmailCode, issueEmailCode, type CodeCheck, type EmailCodePurpose } from '@/lib/authCodes';
import type { CodeSession, DeviceDetails, Me, ProfileUpdate, Session } from '@/lib/contract/v1';
import { prisma } from '@/lib/db';
import { emailTransport, sendCodeEmail } from '@/lib/email';
import { noticeRepeatSignUp, verificationRequired } from '@/lib/emailVerification';
import { logger } from '@/lib/logger';
import { startSession } from '@/lib/mobileAuth';
import { normalizeEmail, passwordProblem } from '@/lib/password';
import { forgetTokenVersion } from '@/lib/sessionVersion';
import type { WriteOutcome } from '@/lib/v1/writes';

/**
 * Signing in from the phone, like real apps (docs/mobile/ROADMAP.md, Phase 2
 * step 4): a code by email instead of a password, creating an account and
 * confirming it with a code, and setting a new password with a code. The rules
 * are the website's (src/lib/auth.ts, /api/register, /api/auth/reset-password):
 * nothing tells a stranger whether an address has an account, and a password
 * set before anyone proved they own the address never survives that proof.
 */

const refuse = (status: number, error: string, code: string) => ({ ok: false, status, error, code }) as const;

const CODE_REFUSALS: Record<Exclude<CodeCheck, 'ok'>, ReturnType<typeof refuse>> = {
    wrong: refuse(400, 'That code isn’t right. Check the latest email from SplitIT.', 'wrong_code'),
    expired: refuse(400, 'That code has expired. Ask for a new one.', 'code_expired'),
    locked: refuse(429, 'Too many tries with that code. Ask for a new one.', 'too_many_guesses'),
};

async function sessionFor(userId: string, device: DeviceDetails): Promise<Session> {
    const tokens = await startSession(userId, device);
    const me = (await meOf(userId)) as Me;
    return { tokens, me };
}

/**
 * Emails a 6-digit code. For a password reset, or confirming an account
 * again, it goes only to an account that needs it, and the answer is the same
 * either way, so the form can't be used to find out who has an account.
 */
export async function sendEmailCode(rawEmail: string, purpose: EmailCodePurpose): Promise<WriteOutcome<{ sent: true }>> {
    const email = normalizeEmail(rawEmail);
    if (!emailTransport()) return refuse(503, 'Codes by email aren’t available right now. Sign in with your password, Google or GitHub.', 'email_off');

    if (purpose !== 'sign_in') {
        const account = await prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, select: { password: true, emailVerified: true } });
        const needs = purpose === 'password_reset' ? Boolean(account) : Boolean(account?.password && !account.emailVerified);
        if (!needs) return { ok: true, value: { sent: true } };
        const code = await issueEmailCode(purpose, email);
        if (code) await sendCodeEmail(email, code, purpose);
        return { ok: true, value: { sent: true } };
    }

    // Anyone can ask for a sign-in code, so saying "slow down" here gives nothing away.
    const code = await issueEmailCode(purpose, email);
    if (!code) return refuse(429, 'You’ve asked for a lot of codes. Wait a while, then try again.', 'too_many_codes');
    await sendCodeEmail(email, code, purpose);
    return { ok: true, value: { sent: true } };
}

/**
 * Signs in with an emailed code. A new address gets an account (its address
 * proven by the code); an existing one is confirmed. A password set before the
 * address was proven is removed, as a Google or GitHub sign-in removes it: it
 * may have been set by someone who signed up with another person's address.
 * After confirm_sign_up, the password just chosen with the code stays.
 */
export async function signInWithEmailCode(rawEmail: string, code: string, purpose: 'sign_in' | 'confirm_sign_up', device: DeviceDetails): Promise<WriteOutcome<CodeSession>> {
    const email = normalizeEmail(rawEmail);
    const check = await checkEmailCode(purpose, email, code);
    if (check !== 'ok') return CODE_REFUSALS[check];

    const now = new Date();
    let account = await prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, select: { id: true, name: true, password: true, emailVerified: true } });
    if (!account) {
        if (purpose === 'confirm_sign_up') return CODE_REFUSALS.expired;
        try {
            account = await prisma.user.create({ data: { email, emailVerified: now }, select: { id: true, name: true, password: true, emailVerified: true } });
        } catch (error) {
            // Created by another request at the same moment: use it.
            if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
            account = await prisma.user.findFirstOrThrow({ where: { email: { equals: email, mode: 'insensitive' } }, select: { id: true, name: true, password: true, emailVerified: true } });
        }
    } else if (!account.emailVerified) {
        const unproven = purpose === 'sign_in' && Boolean(account.password);
        await prisma.user.update({ where: { id: account.id }, data: { emailVerified: now, ...(unproven ? { password: null } : {}) } });
        if (unproven) logger.warn('Removed a password set before the address was verified', { provider: 'email-code' });
    }

    const session = await sessionFor(account.id, device);
    return { ok: true, value: { ...session, isNew: !account.name } };
}

/**
 * Creates an account with a password, by the website's rules (/api/register).
 * While SplitIT can send email, the address is confirmed with a code first; an
 * address that already has an account gets the website's "you already have an
 * account" email instead, and the same answer.
 */
export async function signUp(name: string, rawEmail: string, password: string, device: DeviceDetails): Promise<WriteOutcome<{ codeSent: boolean; session: Session | null }>> {
    const problem = passwordProblem(password);
    if (problem) return refuse(400, problem, 'weak_password');
    const email = normalizeEmail(rawEmail);
    const mustConfirm = verificationRequired();
    const hashedPassword = await bcrypt.hash(password, 12);

    const alreadyRegistered = async (): Promise<WriteOutcome<{ codeSent: boolean; session: Session | null }>> => {
        if (!mustConfirm) return refuse(409, 'An account with this email already exists. Sign in instead.', 'exists');
        try {
            await noticeRepeatSignUp(email);
        } catch (error) {
            logger.error('Could not email the owner of an address that signed up again', { err: error });
        }
        return { ok: true, value: { codeSent: true, session: null } };
    };

    if (await prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, select: { id: true } })) return alreadyRegistered();
    let user;
    try {
        user = await prisma.user.create({ data: { name, email, password: hashedPassword }, select: { id: true } });
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return alreadyRegistered();
        throw error;
    }

    if (!mustConfirm) return { ok: true, value: { codeSent: false, session: await sessionFor(user.id, device) } };
    const code = await issueEmailCode('confirm_sign_up', email);
    if (code) {
        try {
            await sendCodeEmail(email, code, 'confirm_sign_up');
        } catch (error) {
            logger.error('Could not send the confirmation code', { err: error });
        }
    }
    return { ok: true, value: { codeSent: true, session: null } };
}

/**
 * Sets a new password with an emailed code, as the website's reset link does:
 * every session of the account ends (it may be resetting because the old one
 * leaked), the address counts as confirmed, and this phone is signed in.
 */
export async function resetPasswordWithCode(rawEmail: string, code: string, password: string, device: DeviceDetails): Promise<WriteOutcome<Session>> {
    const problem = passwordProblem(password);
    if (problem) return refuse(400, problem, 'weak_password');
    const email = normalizeEmail(rawEmail);
    const check = await checkEmailCode('password_reset', email, code);
    if (check !== 'ok') return CODE_REFUSALS[check];

    const account = await prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, select: { id: true, email: true, emailVerified: true } });
    if (!account) return CODE_REFUSALS.expired;
    const hashedPassword = await bcrypt.hash(password, 12);
    await prisma.$transaction([
        prisma.user.update({
            where: { id: account.id },
            data: { password: hashedPassword, tokenVersion: { increment: 1 }, ...(account.emailVerified ? {} : { emailVerified: new Date() }) },
        }),
        // Any reset link the website emailed stops working too.
        prisma.passwordResetToken.deleteMany({ where: { email: account.email ?? email } }),
    ]);
    forgetTokenVersion(account.id);
    return { ok: true, value: await sessionFor(account.id, device) };
}

/** Signs out every phone and browser of the account, this one included. */
export async function signOutEverywhere(userId: string) {
    await prisma.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } });
    forgetTokenVersion(userId);
}

/** Your name and UPI ID, by the website's profile rules. */
export async function updateProfile(userId: string, update: ProfileUpdate): Promise<Me | null> {
    const data: Record<string, string> = {};
    if (update.name) data.name = update.name;
    if (update.upiId !== undefined) data.upiId = update.upiId;
    if (Object.keys(data).length > 0) await prisma.user.update({ where: { id: userId }, data });
    return meOf(userId);
}
