import { hostname } from 'node:os';
import { NextResponse } from 'next/server';

/**
 * GET /api/health/live — liveness probe.
 *
 * Deliberately depends on nothing outside this process. A database cold start
 * or outage must not make Kubernetes restart every pod at once; liveness only
 * answers "is this Node process still able to respond?".
 */
export const dynamic = 'force-dynamic';

export function GET() {
    return NextResponse.json(
        {
            status: 'alive',
            pod: process.env.POD_NAME || hostname(),
            uptimeSeconds: Math.round(process.uptime()),
        },
        { headers: { 'Cache-Control': 'no-store' } }
    );
}
