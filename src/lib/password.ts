/**
 * What a password must be, checked the same way in the browser and on the
 * server.
 *
 * At least 8 characters. At most 72 bytes of UTF-8: bcrypt reads only the
 * first 72, so a longer password would match any other that starts the same
 * way. 72 bytes is 72 ASCII characters, or 18 to 24 emoji.
 */

export const PASSWORD_MIN_CHARS = 8;
export const PASSWORD_MAX_BYTES = 72;

/** Why the password can't be used, or null when it can. */
export function passwordProblem(password: string): string | null {
    if (password.length < PASSWORD_MIN_CHARS) return `Use at least ${PASSWORD_MIN_CHARS} characters for your password.`;
    if (new TextEncoder().encode(password).length > PASSWORD_MAX_BYTES) return 'That password is too long. Use at most 72 characters.';
    return null;
}

/** Emails are compared and stored in lower case, without surrounding spaces. */
export function normalizeEmail(email: string) {
    return email.trim().toLowerCase();
}
