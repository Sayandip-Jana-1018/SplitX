import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { sendMail, createTransport, resendSend } = vi.hoisted(() => {
    const sendMail = vi.fn();
    return {
        sendMail,
        createTransport: vi.fn(() => ({ sendMail })),
        resendSend: vi.fn(),
    };
});

vi.mock('nodemailer', () => ({ default: { createTransport } }));
vi.mock('resend', () => ({ Resend: class { emails = { send: resendSend }; } }));

const email = await import('@/lib/email');

const clearTransportCache = () => {
    delete (globalThis as { __splitxSmtp?: unknown }).__splitxSmtp;
};

beforeEach(() => {
    clearTransportCache();
    vi.stubEnv('SMTP_HOST', '');
    vi.stubEnv('SMTP_USER', '');
    vi.stubEnv('SMTP_PASSWORD', '');
    vi.stubEnv('RESEND_API_KEY', '');
    vi.stubEnv('EMAIL_FROM', '');
    vi.stubEnv('NEXTAUTH_URL', 'https://splitx.example/');
});

afterEach(() => {
    vi.resetAllMocks();
    vi.unstubAllEnvs();
    clearTransportCache();
});

const useSmtp = () => {
    vi.stubEnv('SMTP_HOST', 'smtp.gmail.com');
    vi.stubEnv('SMTP_USER', 'splitx.mailer@example.com');
    vi.stubEnv('SMTP_PASSWORD', 'app-password');
};

describe('emailTransport', () => {
    it('uses SMTP when it is set up', () => {
        useSmtp();
        expect(email.emailTransport()).toBe('smtp');
    });

    it("uses Resend only with a sender on the owner's own domain", () => {
        vi.stubEnv('RESEND_API_KEY', 're_test');
        expect(email.emailTransport()).toBeNull();

        vi.stubEnv('EMAIL_FROM', 'SplitX <onboarding@resend.dev>');
        expect(email.emailTransport()).toBeNull();

        vi.stubEnv('EMAIL_FROM', 'SplitX <mail@splitx.example>');
        expect(email.emailTransport()).toBe('resend');
    });

    it('is null with nothing set up, and sending says so', async () => {
        expect(email.emailTransport()).toBeNull();
        await expect(email.sendEmail({ to: 'a@example.com', subject: 's', html: 'h', text: 't' })).rejects.toBeInstanceOf(email.EmailNotConfigured);
    });
});

describe('sending', () => {
    it('sends over SMTP from the SMTP account, with a plain-text copy and a link back to the site', async () => {
        useSmtp();
        sendMail.mockResolvedValue({ messageId: 'm1' });

        await email.sendVerificationEmail('friend@example.com', 'tok/en+1');

        expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({
            host: 'smtp.gmail.com',
            port: 465,
            secure: true,
            auth: { user: 'splitx.mailer@example.com', pass: 'app-password' },
        }));
        const message = sendMail.mock.calls[0][0];
        expect(message).toMatchObject({ from: 'SplitX <splitx.mailer@example.com>', to: 'friend@example.com', subject: 'Confirm your email for SplitX' });
        expect(message.html).toContain('https://splitx.example/verify-email?token=tok%2Fen%2B1');
        expect(message.text).toContain('Confirm email: https://splitx.example/verify-email?token=tok%2Fen%2B1');
        expect(message.text).not.toContain('<');
    });

    it('reports a failure Resend returns instead of throwing (it used to be ignored)', async () => {
        vi.stubEnv('RESEND_API_KEY', 're_test');
        vi.stubEnv('EMAIL_FROM', 'SplitX <mail@splitx.example>');
        resendSend.mockResolvedValue({ data: null, error: { message: 'domain not verified' } });

        await expect(email.sendPasswordResetEmail('friend@example.com', 'token')).rejects.toThrow('Resend refused the email: domain not verified');
    });

    it('refuses to build a link without the site address', async () => {
        useSmtp();
        vi.stubEnv('NEXTAUTH_URL', '');
        vi.stubEnv('AUTH_URL', '');

        await expect(email.sendPasswordResetEmail('friend@example.com', 'token')).rejects.toThrow('NEXTAUTH_URL is not set');
        expect(sendMail).not.toHaveBeenCalled();
    });
});
