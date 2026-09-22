import { createHash, randomBytes } from 'node:crypto';

/**
 * Single-use links sent by email: password resets and address confirmations.
 * The link carries the token; the database keeps only its SHA-256, so someone
 * who can read the table can't use what they find there.
 */

export function newSecretToken() {
    return randomBytes(32).toString('base64url');
}

export function hashSecretToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
}
