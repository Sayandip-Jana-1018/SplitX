import { NextResponse } from 'next/server';
import { opsViewer } from '@/lib/ops/access';
import { readCodeScanning, readDeliveries, readDependabot, readPipeline } from '@/lib/ops/github';
import { readQualityGate } from '@/lib/ops/quality';
import { siteUrl } from '@/lib/siteUrl';

export const dynamic = 'force-dynamic';

/**
 * GET /api/ops/summary — the pipeline half of /ops, for operators only. The
 * cluster half (nodes, pods, the traffic lab, alerts, logs, the AWS stacks)
 * comes from ops-api through /api/ops/cluster, polled more often (D-097).
 */
export async function GET(request: Request) {
    const viewer = await opsViewer();
    if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!viewer.allowed) return NextResponse.json({ error: 'Only SplitX operators can read this.' }, { status: 403 });

    const [pipeline, codeScanning, dependabot, deliveries, qualityGate] = await Promise.all([
        readPipeline(),
        readCodeScanning(),
        readDependabot(),
        readDeliveries(),
        readQualityGate(),
    ]);

    return NextResponse.json(
        { pipeline, codeScanning, dependabot, deliveries, qualityGate, site: siteUrl(request) },
        { headers: { 'Cache-Control': 'no-store' } }
    );
}
