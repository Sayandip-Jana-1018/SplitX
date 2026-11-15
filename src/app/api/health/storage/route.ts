import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { RECEIPTS_BUCKET } from '@/lib/receiptUrl';
import { storageAdmin, StorageUnavailableError } from '@/lib/storage';
import { withTimeout } from '@/lib/withTimeout';

/**
 * GET /api/health/storage: receipt and profile photos can be reached
 * (Supabase Storage). The live-site checks ask it once an hour
 * (scripts/lib/uptime.mjs), which also keeps the free Supabase project from
 * pausing: a project with no requests for a week is paused, and photos stop
 * loading until someone restores it by hand.
 *
 * One look at the bucket is shared for ten minutes, however many ask, so a
 * stream of requests can't become a stream of Supabase calls. The answer says
 * only ok or not: nothing about what the bucket holds.
 */
export const dynamic = 'force-dynamic';

const SHARED_MS = 10 * 60_000;
const TIMEOUT_MS = 4_000;
const noStore = { 'Cache-Control': 'no-store' };

type Look = { ok: true } | { ok: false; storage: 'not_configured' | 'unreachable' };

let last: { at: number; look: Look } | null = null;
let looking: Promise<Look> | null = null;

async function lookAtBucket(): Promise<Look> {
    try {
        const { error } = await withTimeout(storageAdmin().storage.from(RECEIPTS_BUCKET).list('', { limit: 1 }), TIMEOUT_MS);
        if (error) throw error;
        return { ok: true };
    } catch (error) {
        if (error instanceof StorageUnavailableError) return { ok: false, storage: 'not_configured' };
        logger.error('Storage health check failed', { err: error });
        return { ok: false, storage: 'unreachable' };
    }
}

/** For the unit tests: forget the shared look. */
export function forgetStorageLook() {
    last = null;
    looking = null;
}

export async function GET() {
    const now = Date.now();
    if (!last || now - last.at >= SHARED_MS) {
        looking ??= lookAtBucket().finally(() => {
            looking = null;
        });
        last = { at: now, look: await looking };
    }
    const { look } = last;
    return look.ok
        ? NextResponse.json({ status: 'ready', checks: { storage: 'ok' } }, { headers: noStore })
        : NextResponse.json({ status: 'not_ready', checks: { storage: look.storage } }, { status: 503, headers: noStore });
}
