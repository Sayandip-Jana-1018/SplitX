import { createHash, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { metrics, register } from '@/lib/metrics';
import { withTimeout } from '@/lib/withTimeout';

/**
 * GET /api/metrics — Prometheus scrape endpoint.
 *
 * Requires `Authorization: Bearer <METRICS_TOKEN>`. In production an unset
 * token fails closed rather than open: an unset variable once left this
 * endpoint publicly readable.
 */
export const dynamic = 'force-dynamic';

const ACTIVE_GROUPS_TTL_MS = 30_000;
const DB_TIMEOUT_MS = 1_500;

let warnedUnconfigured = false;
let activeGroupsRefreshedAt = 0;

const digest = (value: string) => createHash('sha256').update(value).digest();

function isAuthorized(header: string | null, expected: string) {
    const given = header?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
    // Comparing fixed-length digests keeps the check constant-time, including for length.
    return Boolean(given) && timingSafeEqual(digest(given as string), digest(expected));
}

/** A count per scrape per pod adds up; refresh at most every 30s and never fail the scrape over it. */
async function refreshActiveGroups() {
    const now = Date.now();
    if (now - activeGroupsRefreshedAt < ACTIVE_GROUPS_TTL_MS) return;
    activeGroupsRefreshedAt = now;
    try {
        metrics.activeGroups.set(await withTimeout(prisma.group.count({ where: { deletedAt: null } }), DB_TIMEOUT_MS));
    } catch {
        // Keep the last known value.
    }
}

export async function GET(request: Request) {
    const expected = process.env.METRICS_TOKEN;

    if (expected) {
        if (!isAuthorized(request.headers.get('authorization'), expected)) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
    } else if (process.env.NODE_ENV === 'production') {
        if (!warnedUnconfigured) {
            console.error('[metrics] METRICS_TOKEN is not set; refusing to serve metrics');
            warnedUnconfigured = true;
        }
        return NextResponse.json({ error: 'Metrics endpoint is not configured' }, { status: 503 });
    }

    try {
        await refreshActiveGroups();
        return new Response(await register.metrics(), {
            status: 200,
            headers: {
                'Content-Type': register.contentType,
                'Cache-Control': 'no-store',
            },
        });
    } catch {
        return NextResponse.json({ error: 'Failed to collect metrics' }, { status: 500 });
    }
}
