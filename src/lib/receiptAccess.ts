import { logger } from '@/lib/logger';
import { privateReceiptPath, RECEIPT_PHOTOS_BUCKET, withTrustedReceipt } from '@/lib/receiptUrl';
import { storageAdmin } from '@/lib/storage';

/**
 * How long a signed link to a receipt photo works: long enough to look at it,
 * short enough that a copied or leaked link soon opens nothing.
 */
export const RECEIPT_VIEW_SECONDS = 60 * 60;

/**
 * Expenses as they are answered to the people allowed to see them (callers
 * check that first): a stored URL that fails the trust check is dropped, and a
 * photo in the private bucket becomes a signed link. One call to storage signs
 * every photo in the list. If storage can't sign, those photos are left out and
 * the rest of the answer still arrives.
 */
export async function withViewableReceipts<T extends { receiptUrl?: string | null }>(rows: T[]): Promise<T[]> {
    const trusted = rows.map(withTrustedReceipt);
    const paths = [...new Set(trusted.flatMap((row) => privateReceiptPath(row.receiptUrl) ?? []))];
    if (paths.length === 0) return trusted;

    const signed = new Map<string, string>();
    try {
        const { data, error } = await storageAdmin().storage.from(RECEIPT_PHOTOS_BUCKET).createSignedUrls(paths, RECEIPT_VIEW_SECONDS);
        if (error) throw error;
        for (const entry of data) {
            if (entry.path && entry.signedUrl && !entry.error) signed.set(entry.path, entry.signedUrl);
        }
    } catch (error) {
        logger.warn('Could not sign receipt photos', { err: error, photos: paths.length });
    }

    return trusted.map((row) => {
        const path = privateReceiptPath(row.receiptUrl);
        return path === null ? row : { ...row, receiptUrl: signed.get(path) ?? null };
    });
}
