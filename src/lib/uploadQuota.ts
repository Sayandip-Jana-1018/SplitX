import { consumeAllowance } from '@/lib/rateLimit';

/**
 * Daily allowances for receipt photos, which cost storage on every upload:
 * each person may upload 20 a day, and everyone together 300, however many
 * accounts ask. Like the AI allowances they fail closed: without the counter,
 * photos wait. The expense itself still saves; only its photo is left off.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function allowance(variable: string, fallback: number) {
    const value = Number(process.env[variable]);
    return Number.isInteger(value) && value > 0 ? value : fallback;
}

export type UploadQuotaResult =
    | { ok: true }
    | { ok: false; status: 429 | 503; error: string; retryAfterSeconds?: number };

const unavailable: UploadQuotaResult = {
    ok: false,
    status: 503,
    error: 'Receipt photos can’t be saved right now. Please try again later.',
};

export async function takeReceiptUpload(userId: string): Promise<UploadQuotaResult> {
    const perPerson = allowance('RECEIPT_UPLOADS_PER_DAY', 20);
    const mine = await consumeAllowance(`receipt-upload:${userId}`, perPerson, DAY_MS);
    if (mine.outcome === 'unavailable') return unavailable;
    if (mine.outcome === 'deny') {
        return {
            ok: false,
            status: 429,
            error: `You've saved today's ${perPerson} receipt photos. More can be added tomorrow.`,
            retryAfterSeconds: Math.ceil(mine.resetMs / 1000),
        };
    }

    const everyone = await consumeAllowance('receipt-upload:everyone', allowance('RECEIPT_UPLOADS_PER_DAY_ALL', 300), DAY_MS);
    if (everyone.outcome === 'unavailable') return unavailable;
    if (everyone.outcome === 'deny') {
        return {
            ok: false,
            status: 429,
            error: 'SplitX has stored today’s limit of receipt photos. Please add this one tomorrow.',
            retryAfterSeconds: Math.ceil(everyone.resetMs / 1000),
        };
    }
    return { ok: true };
}
