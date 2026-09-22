import { createHash, randomBytes } from 'node:crypto';

/**
 * Password-reset tokens. The link carries the token; the database keeps only
 * its SHA-256, so someone who can read the table can't reset anyone's
 * password with what they find there.
 */

export function newResetToken() {
    return randomBytes(32).toString('base64url');
}

export function hashResetToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
}
