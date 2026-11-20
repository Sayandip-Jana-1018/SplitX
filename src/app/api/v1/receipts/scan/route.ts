import { readV1Body, requireCaller, v1Error, v1Json } from '@/lib/apiV1';
import { RECEIPT_IMAGE_MAX_CHARS, ReceiptScanRequest } from '@/lib/contract/v1';
import { logger } from '@/lib/logger';
import { scanReceipt } from '@/lib/services/receiptScan';

/**
 * POST /api/v1/receipts/scan: the phone's photo of a bill, read by the same service as the
 * website's scan page (lib/services/receiptScan.ts), within the person's AI allowance.
 */
export async function POST(request: Request) {
    const auth = await requireCaller(request);
    if (!auth.ok) return auth.response;
    const body = await readV1Body(request, ReceiptScanRequest, RECEIPT_IMAGE_MAX_CHARS + 1_000);
    if (!body.ok) return body.response;
    try {
        const outcome = await scanReceipt(auth.caller.userId, body.data.image);
        if (outcome.ok) return v1Json(outcome.scan);
        const response = v1Error(outcome.error, outcome.status, outcome.code);
        if (outcome.retryAfterSeconds) response.headers.set('Retry-After', String(outcome.retryAfterSeconds));
        return response;
    } catch (error) {
        logger.error('Phone receipt scan failed', { err: error });
        return v1Error('Couldn’t scan that bill. Try again.', 500, 'server_error');
    }
}
