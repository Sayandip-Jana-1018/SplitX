/**
 * Idempotency keys: the client makes one for each thing it asks the server to
 * create, and sends it again with every retry, so the server can tell "save
 * this" from "save this again" (a double tap, or a retry after the network
 * dropped the answer to a save that worked). See POST /api/transactions.
 */

/** What the server accepts in the Idempotency-Key header. */
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{16,100}$/;

/** A new random key (122 bits), in the browser or on the server. */
export function newIdempotencyKey(): string {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
