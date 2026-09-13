import { hostname } from 'node:os';
import { isValidTraceId, trace } from '@opentelemetry/api';

/**
 * Structured server logs: one JSON object per line on stdout (info/debug) or
 * stderr (warn/error), ready for Loki. Each line carries the request ID of the
 * request being handled, taken from the active trace, so a single ID pulls up
 * every line a request produced across every pod.
 *
 * Server-only — never import from a client component.
 */

type Level = 'debug' | 'info' | 'warn' | 'error';
type Fields = Record<string, unknown>;

const SEVERITY: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const base = {
    service: 'splitx',
    pod: process.env.POD_NAME || hostname(),
    version: process.env.APP_VERSION || 'dev',
};

function threshold() {
    const configured = process.env.LOG_LEVEL as Level | undefined;
    return SEVERITY[configured ?? 'info'] ?? SEVERITY.info;
}

function activeRequestId() {
    const traceId = trace.getActiveSpan()?.spanContext().traceId;
    return traceId && isValidTraceId(traceId) ? traceId : undefined;
}

function serializeError(error: unknown) {
    if (!(error instanceof Error)) return error;
    const { code } = error as Error & { code?: unknown };
    return { name: error.name, message: error.message, ...(code !== undefined ? { code } : {}), stack: error.stack };
}

function write(level: Level, msg: string, fields: Fields = {}) {
    if (SEVERITY[level] < threshold()) return;

    const entry: Fields = {
        ts: new Date().toISOString(),
        level,
        msg,
        ...base,
        requestId: activeRequestId(),
    };
    for (const [key, value] of Object.entries(fields)) {
        if (value !== undefined) entry[key] = serializeError(value);
    }

    let line: string;
    try {
        line = JSON.stringify(entry);
    } catch {
        line = JSON.stringify({ ts: entry.ts, level, msg, ...base, requestId: entry.requestId, note: 'fields were not serialisable' });
    }
    (SEVERITY[level] >= SEVERITY.warn ? process.stderr : process.stdout).write(`${line}\n`);
}

export const logger = {
    debug: (msg: string, fields?: Fields) => write('debug', msg, fields),
    info: (msg: string, fields?: Fields) => write('info', msg, fields),
    warn: (msg: string, fields?: Fields) => write('warn', msg, fields),
    error: (msg: string, fields?: Fields) => write('error', msg, fields),
};
