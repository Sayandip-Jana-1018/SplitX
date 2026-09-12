import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { withTimeout } from '@/lib/withTimeout';
import { logger } from '@/lib/logger';

/**
 * GET /api/health/ready — readiness probe.
 *
 * Ready means this pod can serve real requests, which for SplitX requires the
 * database. A failure removes the pod from the Service until it recovers; it
 * never restarts the pod — that is liveness's job, and liveness ignores the DB.
 */
export const dynamic = 'force-dynamic';

const DB_TIMEOUT_MS = 2_000;
const noStore = { 'Cache-Control': 'no-store' };

export async function GET() {
    const started = performance.now();
    try {
        await withTimeout(prisma.$queryRaw`SELECT 1`, DB_TIMEOUT_MS);
        return NextResponse.json(
            { status: 'ready', checks: { database: 'ok' }, latencyMs: Math.round(performance.now() - started) },
            { headers: noStore }
        );
    } catch (error) {
        logger.error('Readiness database check failed', { err: error });
        return NextResponse.json(
            { status: 'not_ready', checks: { database: 'unreachable' } },
            { status: 503, headers: noStore }
        );
    }
}
