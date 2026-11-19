import { requireCaller, v1Error, v1Json } from '@/lib/apiV1';
import type { GroupReceipts } from '@/lib/contract/v1';
import { logger } from '@/lib/logger';
import { groupReceipts } from '@/lib/services/receipts';

/**
 * GET /api/v1/groups/:groupId/receipts: a link for each receipt photo in a group, signed for an
 * hour. The phone already has each expense; this is only what it can't have: links that open.
 */
export async function GET(request: Request, { params }: { params: Promise<{ groupId: string }> }) {
    const auth = await requireCaller(request);
    if (!auth.ok) return auth.response;
    const { groupId } = await params;
    try {
        const found = await groupReceipts(auth.caller.userId, groupId);
        if (!found) return v1Error('That group isn’t here.', 404, 'not_found');
        const answer: GroupReceipts = { receipts: found.receipts.map((receipt) => ({ expenseId: receipt.id, url: receipt.receiptUrl })) };
        return v1Json(answer);
    } catch (error) {
        logger.error('Phone receipts read failed', { err: error });
        return v1Error('Couldn’t load the receipts. Try again.', 500, 'server_error');
    }
}
