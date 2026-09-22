#!/usr/bin/env node
/**
 * Sends one test email with the SMTP settings in .env, so they can be checked
 * before anyone relies on them. It prints what the mail server answered and
 * never prints the settings themselves.
 *
 *   npm run email:test -- someone@example.com
 *
 * Send it to an address you own that is not the sender, the way a real
 * person would receive a reset link.
 */
import nodemailer from 'nodemailer';

const to = process.argv[2];
if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    console.error('Usage: npm run email:test -- someone@example.com');
    process.exit(2);
}

const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, EMAIL_FROM } = process.env;
if (!SMTP_HOST || !SMTP_USER || !SMTP_PASSWORD) {
    console.error('Set SMTP_HOST, SMTP_USER and SMTP_PASSWORD in .env first (see .env.example).');
    process.exit(2);
}

const port = Number(SMTP_PORT) || 465;
const transport = nodemailer.createTransport({
    host: SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASSWORD },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
});

try {
    await transport.verify();
    console.log(`Signed in to ${SMTP_HOST}:${port}.`);
    const info = await transport.sendMail({
        from: EMAIL_FROM || `SplitX <${SMTP_USER}>`,
        to,
        subject: 'SplitX email test',
        text: 'If you can read this, SplitX can send email: password resets and sign-up confirmations will arrive. You can delete this message.',
    });
    console.log(`Sent: the mail server accepted it (${info.response ?? 'no reply text'}). Check the inbox, and the spam folder.`);
} catch (error) {
    console.error(`Not sent: ${error.response ?? error.message}`);
    if (error.code === 'EAUTH') {
        console.error('The sign-in was refused. SMTP_USER must be the full Gmail address, and SMTP_PASSWORD the 16-letter app password, without spaces.');
    }
    process.exit(1);
}
