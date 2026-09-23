import { NextResponse } from 'next/server';
import { opsViewer } from '@/lib/ops/access';
import { readCodeScanning, readDeliveries, readDependabot, readPipeline } from '@/lib/ops/github';
import { readQualityGate } from '@/lib/ops/quality';
import type { Reading } from '@/lib/ops/reading';
import { siteUrl } from '@/lib/siteUrl';

export const dynamic = 'force-dynamic';

/**
 * The cluster half of /ops (nodes, pods, the traffic lab, alerts, logs, the
 * AWS stacks) is read by ops-api inside the cluster, which exists only while
 * the platform runs: on AWS on demo days, on Kind in CI. Here it is reported
 * as not connected, never filled in.
 */
function clusterReading(): Reading<never> {
    return {
        ok: false,
        source: 'ops-api in the cluster',
        fetchedAt: new Date().toISOString(),
        error: 'Not connected here: the cluster runs on AWS on demo days, and on Kind in CI.',
    };
}

/** GET /api/ops/summary — everything /ops shows, for operators only. */
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
        { pipeline, codeScanning, dependabot, deliveries, qualityGate, cluster: clusterReading(), site: siteUrl(request) },
        { headers: { 'Cache-Control': 'no-store' } }
    );
}
