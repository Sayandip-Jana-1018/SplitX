import { NextResponse } from 'next/server';
import { opsViewer } from '@/lib/ops/access';
import { readCluster } from '@/lib/ops/cluster';

export const dynamic = 'force-dynamic';

/**
 * GET /api/ops/cluster — the cluster half of /ops, for operators only: what
 * ops-api read inside the cluster (D-097), or why it can't be read here. /ops
 * polls it every 5 seconds, apart from the GitHub readings, which change slowly.
 */
export async function GET() {
    const viewer = await opsViewer();
    if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!viewer.allowed) return NextResponse.json({ error: 'Only SplitX operators can read this.' }, { status: 403 });

    return NextResponse.json({ cluster: await readCluster() }, { headers: { 'Cache-Control': 'no-store' } });
}
