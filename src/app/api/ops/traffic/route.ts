import { NextResponse } from 'next/server';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { opsViewer } from '@/lib/ops/access';
import { CLUSTER_KEY, commandLab } from '@/lib/ops/cluster';
import { forgetReading } from '@/lib/ops/reading';
import { BodyTooLargeError, readJsonBody } from '@/lib/readJsonBody';

export const dynamic = 'force-dynamic';

/**
 * The traffic lab's start and stop buttons on /ops (D-097), for operators only.
 * The lab has one fixed target and checks these same limits itself
 * (ops/lab/limits.mjs): at most 30 settlement plans a second, for at most three
 * minutes, one run at a time.
 */
const RunSchema = z
    .object({
        rate: z.number().int().min(1).max(30),
        seconds: z.number().int().min(30).max(180),
    })
    .strict();

const NO_STORE = { 'Cache-Control': 'no-store' };

async function operator() {
    const viewer = await opsViewer();
    if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!viewer.allowed) return NextResponse.json({ error: 'Only SplitX operators can run the traffic lab.' }, { status: 403 });
    return null;
}

async function relay(method: 'POST' | 'DELETE', settings?: z.infer<typeof RunSchema>) {
    try {
        const { status, body } = await commandLab(method, settings);
        // The next poll shows the lab as it is now, not as it was a moment ago.
        forgetReading(CLUSTER_KEY);
        logger.info(method === 'POST' ? 'traffic lab run requested' : 'traffic lab stop requested', { ...settings, status });
        return NextResponse.json(body, { status, headers: NO_STORE });
    } catch (error) {
        logger.warn('traffic lab unreachable', { error });
        return NextResponse.json({ error: 'ops-api could not be reached, so the traffic lab was not asked.' }, { status: 502, headers: NO_STORE });
    }
}

/** POST /api/ops/traffic — start a run: { rate, seconds }. */
export async function POST(request: Request) {
    const refused = await operator();
    if (refused) return refused;
    // JSON only: a form on another site can't send it without asking first.
    if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
        return NextResponse.json({ error: 'Send JSON: { "rate": 20, "seconds": 120 }.' }, { status: 415 });
    }

    let body: unknown;
    try {
        body = await readJsonBody(request, 1024);
    } catch (error) {
        if (error instanceof BodyTooLargeError) return NextResponse.json({ error: 'The body must be at most 1 KB.' }, { status: 413 });
        return NextResponse.json({ error: 'Send JSON: { "rate": 20, "seconds": 120 }.' }, { status: 400 });
    }
    const parsed = RunSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ error: 'rate must be a whole number from 1 to 30, and seconds from 30 to 180; nothing else can be chosen.' }, { status: 400 });
    }
    return relay('POST', parsed.data);
}

/** DELETE /api/ops/traffic — stop the run. */
export async function DELETE() {
    const refused = await operator();
    if (refused) return refused;
    return relay('DELETE');
}
