import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM_EMAIL = process.env.EMAIL_FROM || 'AutoSplit <onboarding@resend.dev>';

/**
 * Send a password reset email with a styled HTML template.
 */
export async function sendPasswordResetEmail(email: string, token: string) {
    const resetUrl = `${process.env.NEXTAUTH_URL}/reset-password?token=${token}`;

    await resend.emails.send({
        from: FROM_EMAIL,
        to: email,
        subject: 'Reset your AutoSplit password',
        html: `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#0a0a1a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
    <div style="max-width:480px;margin:40px auto;padding:0 20px;">
        <!-- Logo -->
        <div style="text-align:center;margin-bottom:32px;">
            <div style="display:inline-flex;align-items:center;gap:8px;">
                <div style="width:36px;height:36px;background:linear-gradient(135deg,#6366f1,#8b5cf6);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:16px;">⚡</div>
                <span style="font-size:20px;font-weight:800;color:#fff;">AutoSplit</span>
            </div>
        </div>

        <!-- Card -->
        <div style="background:rgba(20,20,45,0.9);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:36px 32px;text-align:center;">
            <div style="width:56px;height:56px;background:linear-gradient(135deg,rgba(99,102,241,0.15),rgba(139,92,246,0.15));border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 20px;font-size:24px;">🔒</div>

            <h1 style="font-size:22px;font-weight:700;color:#fff;margin:0 0 8px;">Reset Your Password</h1>
            <p style="font-size:14px;color:#94a3b8;line-height:1.6;margin:0 0 28px;">
                We received a request to reset your password. Click the button below to choose a new one. This link expires in <strong style="color:#c4b5fd;">1 hour</strong>.
            </p>

            <a href="${resetUrl}" style="display:inline-block;padding:12px 36px;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;text-decoration:none;border-radius:10px;font-weight:700;font-size:14px;letter-spacing:0.3px;">
                Reset Password
            </a>

            <p style="font-size:12px;color:#64748b;margin:24px 0 0;line-height:1.5;">
                If you didn't request this, you can safely ignore this email.<br>
                Your password will remain unchanged.
            </p>
        </div>

        <!-- Footer -->
        <p style="text-align:center;font-size:11px;color:#475569;margin-top:24px;">
            © ${new Date().getFullYear()} AutoSplit · Expense splitting made easy
        </p>
    </div>
</body>
</html>`,
    });
}
