import { createHash, createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { prisma } from '@/lib/db';
import { consumeAllowance } from '@/lib/rateLimit';
import { newSecretToken } from '@/lib/secretTokens';

/**
 * Short-lived codes for the phone app's sign-in (docs/mobile/ROADMAP.md, Phase 2 step 4).
 *
 * - Emailed 6-digit codes: to sign in without a password, to confirm a new
 *   account, or to set a new password. Valid for 10 minutes, five guesses,
 *   one live code per address and purpose (a new one replaces the old), and a
 *   few per address per hour so nobody's inbox can be flooded.
 * - Hand-off codes: after a Google or GitHub sign-in on the website's own
 *   page, the website hands the phone a one-time code that works for 2
 *   minutes, and only with the PKCE verifier of the phone that asked.
 *
 * Codes are kept only as an HMAC keyed with the server's secret, so a copy of
 * the table can't be checked against all million 6-digit codes offline.
 */

export type EmailCodePurpose = 'sign_in' | 'confirm_sign_up' | 'password_reset';

const EMAIL_CODE_TTL_MS = 10 * 60 * 1000;
export const EMAIL_CODE_GUESSES = 5;
const EMAIL_CODES_PER_HOUR = 5;
const HANDOFF_TTL_MS = 2 * 60 * 1000;

function key(): string {
    const secret = process.env.MOBILE_TOKEN_SECRET;
    if (!secret || secret.length < 32) throw new Error('MOBILE_TOKEN_SECRET is not set');
    return secret;
}

function codeHash(purpose: string, subject: string, code: string) {
    return createHmac('sha256', key()).update(`${purpose}\n${subject}\n${code}`).digest('hex');
}

function sameHash(a: string, b: string) {
    const left = Buffer.from(a, 'hex');
    const right = Buffer.from(b, 'hex');
    return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * A new 6-digit code for this address and purpose, replacing any earlier one;
 * or null when the address has had its allowance this hour. The caller emails it.
 */
export async function issueEmailCode(purpose: EmailCodePurpose, email: string, now = new Date()): Promise<string | null> {
    const allowance = await consumeAllowance(`email-code:${purpose}:${email}`, EMAIL_CODES_PER_HOUR, 60 * 60 * 1000);
    if (allowance.outcome === 'deny') return null;
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await prisma.$transaction([
        prisma.authCode.deleteMany({ where: { purpose, email } }),
        prisma.authCode.create({ data: { purpose, email, codeHash: codeHash(purpose, email, code), expiresAt: new Date(now.getTime() + EMAIL_CODE_TTL_MS) } }),
    ]);
    return code;
}

export type CodeCheck = 'ok' | 'wrong' | 'expired' | 'locked';

/**
 * Checks a code once. Every guess counts, right or wrong, so five wrong guesses
 * end it; of two right guesses at once, one wins. A used code can't be used again.
 */
export async function checkEmailCode(purpose: EmailCodePurpose, email: string, code: string, now = new Date()): Promise<CodeCheck> {
    const live = await prisma.authCode.findFirst({
        where: { purpose, email, usedAt: null },
        orderBy: { createdAt: 'desc' },
    });
    if (!live || live.expiresAt <= now) return 'expired';

    // Spend a guess first: a guess the counter didn't let in isn't checked.
    const spent = await prisma.authCode.updateMany({ where: { id: live.id, usedAt: null, attempts: { lt: EMAIL_CODE_GUESSES } }, data: { attempts: { increment: 1 } } });
    if (spent.count === 0) return 'locked';
    if (!/^\d{6}$/.test(code) || !sameHash(live.codeHash, codeHash(purpose, email, code))) {
        return live.attempts + 1 >= EMAIL_CODE_GUESSES ? 'locked' : 'wrong';
    }

    const used = await prisma.authCode.updateMany({ where: { id: live.id, usedAt: null }, data: { usedAt: now } });
    return used.count === 1 ? 'ok' : 'expired';
}

/** base64url SHA-256, as PKCE's S256 method makes a challenge from a verifier. */
function pkceChallenge(verifier: string) {
    return createHash('sha256').update(verifier).digest('base64url');
}

/** A one-time hand-off code for an account the website has just signed in. */
export async function issueHandoffCode(userId: string, challenge: string, now = new Date()): Promise<string> {
    const code = newSecretToken();
    await prisma.authCode.create({
        data: { purpose: 'handoff', userId, challenge, codeHash: codeHash('handoff', '', code), expiresAt: new Date(now.getTime() + HANDOFF_TTL_MS) },
    });
    return code;
}

/** The account a hand-off code was issued for, if it is live and the verifier is the asking phone's. Works once. */
export async function redeemHandoffCode(code: string, verifier: string, now = new Date()): Promise<string | null> {
    const stored = await prisma.authCode.findUnique({ where: { codeHash: codeHash('handoff', '', code) } });
    if (!stored || stored.purpose !== 'handoff' || !stored.userId || !stored.challenge) return null;
    if (stored.usedAt || stored.expiresAt <= now) return null;
    const challenge = Buffer.from(pkceChallenge(verifier));
    const expected = Buffer.from(stored.challenge);
    if (challenge.length !== expected.length || !timingSafeEqual(challenge, expected)) return null;
    const used = await prisma.authCode.updateMany({ where: { id: stored.id, usedAt: null }, data: { usedAt: now } });
    return used.count === 1 ? stored.userId : null;
}
