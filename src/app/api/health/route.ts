import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

/**
 * GET /api/health — Lightweight DB ping to keep Neon warm.
 * Called automatically every 4 minutes by the keepalive component.
 */
export async function GET() {
    try {
        // Cheapest possible query — just asks Postgres for 1
        await prisma.$queryRaw`SELECT 1`;
        return NextResponse.json({ status: 'ok', db: 'connected', ts: Date.now() });
    } catch (error) {
        console.error('[Health] DB ping failed:', error);
        return NextResponse.json(
            { status: 'error', db: 'unreachable', ts: Date.now() },
            { status: 503 }
        );
    }
}
