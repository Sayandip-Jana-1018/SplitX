import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { RECEIPT_IMAGE_MAX_CHARS } from '@/lib/contract/v1';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import { scanReceipt } from '@/lib/services/receiptScan';

/**
 * POST /api/receipt-scan — the scan page's AI mode: reads a bill from a photo.
 * Accepts: { image: string (a JPEG, PNG or WebP data URL) }
 * Returns: the bill's items, taxes and total in paise (lib/services/receiptScan.ts, shared with
 * the phone's POST /api/v1/receipts/scan), or { error } with a status.
 */
export async function POST(req: Request) {
    try {
        const session = await auth();
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        if (Number(req.headers.get('content-length') || 0) > RECEIPT_IMAGE_MAX_CHARS + 1_000) {
            return NextResponse.json({ error: 'That photo is too large to scan. Try again from the camera, or use on-device mode.' }, { status: 413 });
        }
        const body = (await req.json().catch(() => null)) as { image?: unknown } | null;
        const image = typeof body?.image === 'string' ? body.image : '';

        const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } });
        if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

        const outcome = await scanReceipt(user.id, image);
        if (!outcome.ok) {
            return NextResponse.json(
                { error: outcome.error },
                { status: outcome.status, headers: outcome.retryAfterSeconds ? { 'Retry-After': String(outcome.retryAfterSeconds) } : undefined }
            );
        }
        return NextResponse.json(outcome.scan);
    } catch (error) {
        logger.error('Receipt scan error', { err: error });
        return NextResponse.json({ error: 'Couldn’t scan that bill. Try again, or use on-device mode.' }, { status: 500 });
    }
}
