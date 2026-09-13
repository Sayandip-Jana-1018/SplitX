import { randomBytes } from 'node:crypto';

/**
 * Every request gets one ID that follows it everywhere: the proxy starts a W3C
 * trace (`traceparent`), Next.js joins that trace for the route handler, and
 * the trace ID doubles as the `X-Request-Id` header and the `requestId` field
 * in every log line — so one value finds a request in logs, metrics and the
 * client's error report.
 *
 * SplitX is the root of the trace: incoming `traceparent` headers are replaced,
 * so a client cannot choose the ID its requests are logged under.
 */

export const REQUEST_ID_HEADER = 'x-request-id';

export interface TraceContext {
    traceId: string;
    traceparent: string;
}

function nonZeroHex(bytes: number) {
    let hex: string;
    do {
        hex = randomBytes(bytes).toString('hex');
    } while (/^0+$/.test(hex)); // all-zero IDs are invalid in W3C Trace Context
    return hex;
}

export function newTraceContext(): TraceContext {
    const traceId = nonZeroHex(16);
    return { traceId, traceparent: `00-${traceId}-${nonZeroHex(8)}-01` };
}
