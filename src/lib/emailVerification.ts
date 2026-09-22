import { prisma } from '@/lib/db';
import { emailTransport, sendAlreadyRegisteredEmail, sendVerificationEmail } from '@/lib/email';
import { consumeAllowance } from '@/lib/rateLimit';
import { hashSecretToken, newSecretToken } from '@/lib/secretTokens';

/**
 * Confirming that an address belongs to the person who signed up with it.
 *
 * A password account can sign in only once its address is confirmed, so an
 * account opened with someone else's address is never usable (the rest of
 * security finding H2; D-068 covered provider sign-in). This applies only
 * while SplitX can send email (lib/email.ts): without a sender, nobody could
 * ever confirm, so nobody is asked to.
 *
 * Confirmation links are single use, kept as SHA-256 in VerificationToken,
 * valid for a day, and sent at most once every ten minutes per address.
 */

const LINK_MS = 24 * 60 * 60 * 1000;
const RESEND_MS = 10 * 60 * 1000;

export function verificationRequired() {
    return emailTransport() !== null;
}

/**
 * Sends a fresh confirmation link, replacing any earlier one. Returns false
 * when a link went to this address in the last ten minutes.
 */
export async function sendVerificationLink(email: string): Promise<boolean> {
    const recent = await consumeAllowance(`verify-mail:${email}`, 1, RESEND_MS);
    if (recent.outcome === 'deny') return false;

    const token = newSecretToken();
    await prisma.$transaction([
        prisma.verificationToken.deleteMany({ where: { identifier: email } }),
        prisma.verificationToken.create({
            data: { identifier: email, token: hashSecretToken(token), expires: new Date(Date.now() + LINK_MS) },
        }),
    ]);
    await sendVerificationEmail(email, token);
    return true;
}

/** Tells an address's owner that someone tried to sign up with it; at most once every ten minutes. */
export async function noticeRepeatSignUp(email: string) {
    const recent = await consumeAllowance(`signup-notice:${email}`, 1, RESEND_MS);
    if (recent.outcome === 'deny') return;
    await sendAlreadyRegisteredEmail(email);
}

/**
 * Uses a confirmation link. The link is deleted in the same transaction that
 * marks the address confirmed, so it works once. False for an unknown, used or
 * expired link.
 */
export async function confirmEmail(token: string): Promise<boolean> {
    const tokenHash = hashSecretToken(token);
    return prisma.$transaction(async (tx) => {
        const record = await tx.verificationToken.findUnique({ where: { token: tokenHash } });
        const used = await tx.verificationToken.deleteMany({ where: { token: tokenHash, expires: { gt: new Date() } } });
        if (!record || used.count !== 1) return false;

        const confirmed = await tx.user.updateMany({
            where: { email: { equals: record.identifier, mode: 'insensitive' }, emailVerified: null },
            data: { emailVerified: new Date() },
        });
        const alreadyConfirmed = confirmed.count === 0
            && (await tx.user.count({ where: { email: { equals: record.identifier, mode: 'insensitive' } } })) > 0;
        return confirmed.count > 0 || alreadyConfirmed;
    });
}
