import nodemailer, { type Transporter } from 'nodemailer';
import { Resend } from 'resend';
import { siteUrl } from '@/lib/siteUrl';

/**
 * How SplitX sends email: password resets and address verification.
 *
 * - **SMTP** — `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD` (and `SMTP_PORT`,
 *   465 by default). With a Gmail account and an app password this reaches
 *   any address without owning a domain. The sender is `SMTP_USER`: Gmail
 *   rewrites any other From address.
 * - **Resend** — `RESEND_API_KEY` with `EMAIL_FROM` on a domain verified in
 *   Resend. Resend's shared `onboarding@resend.dev` delivers only to the Resend
 *   account's owner, so it is never used: it made reset emails look sent while
 *   reaching nobody else.
 *
 * With neither, `emailTransport()` is null and `sendEmail` throws
 * EmailNotConfigured; the routes that email say so instead of pretending.
 */

export type EmailTransport = 'smtp' | 'resend';

export class EmailNotConfigured extends Error {
    constructor() {
        super('No email sender is configured: set SMTP_HOST, SMTP_USER and SMTP_PASSWORD, or RESEND_API_KEY with EMAIL_FROM on a verified domain');
    }
}

export function emailTransport(): EmailTransport | null {
    if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD) return 'smtp';
    const from = process.env.EMAIL_FROM;
    if (process.env.RESEND_API_KEY && from && !from.includes('@resend.dev')) return 'resend';
    return null;
}

const globalForMail = globalThis as typeof globalThis & { __splitxSmtp?: Transporter };

function smtpTransport() {
    const port = Number(process.env.SMTP_PORT) || 465;
    globalForMail.__splitxSmtp ??= nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port,
        // 465 is encrypted from the first byte; any other port (587) must turn
        // encrypted with STARTTLS before the password is sent, or not send it.
        secure: port === 465,
        requireTLS: port !== 465,
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
        // A request waits on this; a mail server that doesn't answer must not hold it.
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 20_000,
    });
    return globalForMail.__splitxSmtp;
}

export interface OutgoingEmail {
    to: string;
    subject: string;
    html: string;
    text: string;
}

export async function sendEmail(mail: OutgoingEmail) {
    const transport = emailTransport();
    if (transport === 'smtp') {
        await smtpTransport().sendMail({
            from: process.env.EMAIL_FROM || `SplitX <${process.env.SMTP_USER}>`,
            ...mail,
        });
        return;
    }
    if (transport === 'resend') {
        const { error } = await new Resend(process.env.RESEND_API_KEY).emails.send({
            from: process.env.EMAIL_FROM as string,
            ...mail,
        });
        if (error) throw new Error(`Resend refused the email: ${error.message}`);
        return;
    }
    throw new EmailNotConfigured();
}

/** The site's own address, for links in emails (lib/siteUrl.ts); there is no request to fall back on. */
function appUrl() {
    const url = siteUrl();
    if (!url) throw new Error('NEXTAUTH_URL is not set, so emails cannot link back to the site');
    return url;
}

/** One layout for every SplitX email: a heading, a sentence, a button, and a plain-text copy. */
function layout(params: { icon: string; title: string; body: string; button: string; url: string; footnote: string }) {
    const html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#0a0a1a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
    <div style="max-width:480px;margin:40px auto;padding:0 20px;">
        <div style="text-align:center;margin-bottom:32px;">
            <div style="display:inline-flex;align-items:center;gap:8px;">
                <div style="width:36px;height:36px;background:linear-gradient(135deg,#6366f1,#8b5cf6);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:16px;">⚡</div>
                <span style="font-size:20px;font-weight:800;color:#fff;">SplitX</span>
            </div>
        </div>
        <div style="background:rgba(20,20,45,0.9);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:36px 32px;text-align:center;">
            <div style="width:56px;height:56px;background:linear-gradient(135deg,rgba(99,102,241,0.15),rgba(139,92,246,0.15));border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 20px;font-size:24px;">${params.icon}</div>
            <h1 style="font-size:22px;font-weight:700;color:#fff;margin:0 0 8px;">${params.title}</h1>
            <p style="font-size:14px;color:#94a3b8;line-height:1.6;margin:0 0 28px;">${params.body}</p>
            <a href="${params.url}" style="display:inline-block;padding:12px 36px;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;text-decoration:none;border-radius:10px;font-weight:700;font-size:14px;letter-spacing:0.3px;">${params.button}</a>
            <p style="font-size:12px;color:#64748b;margin:24px 0 0;line-height:1.5;">${params.footnote}</p>
        </div>
        <p style="text-align:center;font-size:11px;color:#475569;margin-top:24px;">© ${new Date().getFullYear()} SplitX · Expense splitting made easy</p>
    </div>
</body>
</html>`;
    // A tag can't hold "<", so each "<" is looked at once: the templates' tags come out the same.
    const strip = (value: string) => value.replace(/<[^<>]+>/g, '');
    const text = `${strip(params.title)}\n\n${strip(params.body)}\n\n${params.button}: ${params.url}\n\n${strip(params.footnote).replace(/\s+/g, ' ')}\n`;
    return { html, text };
}

/** A link to choose a new password, valid for one hour. */
export async function sendPasswordResetEmail(email: string, token: string) {
    const url = `${appUrl()}/reset-password?token=${encodeURIComponent(token)}`;
    await sendEmail({
        to: email,
        subject: 'Reset your SplitX password',
        ...layout({
            icon: '🔒',
            title: 'Reset your password',
            body: 'We received a request to reset your password. Choose a new one with the button below. This link expires in <strong style="color:#c4b5fd;">1 hour</strong>.',
            button: 'Reset password',
            url,
            footnote: 'If you didn’t ask for this, you can ignore this email.<br>Your password stays the same.',
        }),
    });
}

/**
 * Sent instead of a confirmation when someone signs up with an address that
 * already has an account: the form answers the same either way, and the owner
 * hears about it.
 */
export async function sendAlreadyRegisteredEmail(email: string) {
    const url = `${appUrl()}/login`;
    await sendEmail({
        to: email,
        subject: 'You already have a SplitX account',
        ...layout({
            icon: '👋',
            title: 'You already have an account',
            body: 'Someone just tried to create a SplitX account with this address. If it was you, sign in instead, or reset your password from the sign-in page.',
            button: 'Sign in',
            url,
            footnote: 'If it wasn’t you, you can ignore this email.<br>Nothing about your account has changed.',
        }),
    });
}

/** A link that proves this address belongs to the person who signed up, valid for one day. */
export async function sendVerificationEmail(email: string, token: string) {
    const url = `${appUrl()}/verify-email?token=${encodeURIComponent(token)}`;
    await sendEmail({
        to: email,
        subject: 'Confirm your email for SplitX',
        ...layout({
            icon: '✉️',
            title: 'Confirm your email',
            body: 'Confirm this address to finish setting up your SplitX account. This link expires in <strong style="color:#c4b5fd;">24 hours</strong>.',
            button: 'Confirm email',
            url,
            footnote: 'If you didn’t sign up for SplitX, you can ignore this email.<br>No account will be opened with this address.',
        }),
    });
}
