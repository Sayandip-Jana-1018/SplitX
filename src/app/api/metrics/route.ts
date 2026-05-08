import { NextResponse } from 'next/server';
import { register } from '@/lib/metrics';

/**
 * GET /api/metrics — Prometheus-compatible metrics endpoint.
 * Protected by a bearer token to prevent public access.
 */
export async function GET(request: Request) {
    // Token-based auth for metrics endpoint
    const token = request.headers.get('authorization')?.replace('Bearer ', '');
    const expectedToken = process.env.METRICS_TOKEN;

    if (expectedToken && token !== expectedToken) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const metrics = await register.metrics();
        return new Response(metrics, {
            status: 200,
            headers: {
                'Content-Type': register.contentType,
                'Cache-Control': 'no-cache, no-store, must-revalidate',
            },
        });
    } catch {
        return NextResponse.json({ error: 'Failed to collect metrics' }, { status: 500 });
    }
}
