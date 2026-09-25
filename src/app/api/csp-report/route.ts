import { NextResponse } from 'next/server';
import { parseCspReports } from '@/lib/security/contentSecurityPolicy';
import { recordCspViolation } from '@/lib/metrics';
import { logger } from '@/lib/logger';

const MAX_BODY_BYTES = 16 * 1024;
const LOG_EVERY_MS = 10_000;

const globalForCsp = globalThis as typeof globalThis & { __splitxCspLoggedAt?: number };

// POST /api/csp-report — where browsers report what the Content-Security-Policy
// blocked (it is enforced since D-108; before, what it would have). Counted in
// splitx_csp_violations_total; logged at most once every ten seconds per
// process, so a noisy page or a flood of fake reports can't fill the logs.
export async function POST(req: Request) {
    const text = await req.text().catch(() => '');
    if (text.length > MAX_BODY_BYTES) return new NextResponse(null, { status: 413 });

    let payload: unknown = null;
    try {
        payload = JSON.parse(text);
    } catch {
        return new NextResponse(null, { status: 400 });
    }

    const violations = parseCspReports(payload);
    for (const violation of violations) recordCspViolation(violation.directive, violation.source);

    const now = Date.now();
    if (violations.length > 0 && now - (globalForCsp.__splitxCspLoggedAt ?? 0) > LOG_EVERY_MS) {
        globalForCsp.__splitxCspLoggedAt = now;
        logger.warn('Content-Security-Policy violation reported', { violations: violations.slice(0, 5) });
    }

    return new NextResponse(null, { status: 204 });
}
