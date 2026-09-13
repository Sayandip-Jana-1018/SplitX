/**
 * Receipt images only ever live in SplitX's own Supabase Storage.
 *
 * A receipt URL is shown to everyone in a group as an image and as an
 * "open original" link, so accepting arbitrary URLs would let one member put a
 * phishing link, a tracking pixel or a `javascript:` URL in front of the rest.
 * Anything that isn't an object URL on the configured storage origin is
 * rejected on write and dropped on read.
 */

/** The public bucket that holds receipt photos (and, under avatars/, profile photos). */
export const RECEIPTS_BUCKET = 'receipts';

const STORAGE_PATH_PREFIX = '/storage/v1/object/';
const MAX_URL_LENGTH = 2_048;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

function storageOrigin(): string | null {
    const configured = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!configured) return null;
    try {
        const url = new URL(configured);
        const secure = url.protocol === 'https:' || (url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname));
        return secure ? url.origin : null;
    } catch {
        return null;
    }
}

export function isTrustedReceiptUrl(value: unknown): value is string {
    if (typeof value !== 'string' || value.length > MAX_URL_LENGTH) return false;
    const origin = storageOrigin();
    if (!origin) return false;
    try {
        const url = new URL(value);
        return url.origin === origin && url.pathname.startsWith(STORAGE_PATH_PREFIX);
    } catch {
        return false;
    }
}

/**
 * A receipt this user uploaded through SplitX: signed uploads always land in
 * the uploader's own folder, so a new expense can't borrow anyone else's photo.
 */
export function isOwnReceiptUrl(value: unknown, userId: string): value is string {
    if (!isTrustedReceiptUrl(value)) return false;
    return new URL(value).pathname.startsWith(`${STORAGE_PATH_PREFIX}public/${RECEIPTS_BUCKET}/${userId}/`);
}

/** Clears a stored receipt URL that fails the trust check (rows saved before validation existed). */
export function withTrustedReceipt<T extends { receiptUrl?: string | null }>(row: T): T {
    if (row.receiptUrl == null || isTrustedReceiptUrl(row.receiptUrl)) return row;
    return { ...row, receiptUrl: null };
}
