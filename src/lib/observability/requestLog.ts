import { AlwaysOnSampler, NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import type { ReadableSpan, SpanProcessor } from '@opentelemetry/sdk-trace-node';
import { logger } from '@/lib/logger';

/**
 * The access log, written from Next.js's own request span.
 *
 * Next wraps every request in a `BaseServer.handleRequest` span and, once the
 * handler has finished, stamps it with the final status code and the matched
 * route pattern (`/api/groups/[groupId]`, not the raw URL). That makes the span
 * the one place that knows the real outcome and the real duration — the proxy
 * can't, because it returns before the route handler runs.
 *
 * Registering the tracer is also what gives every log line inside a request
 * its request ID (lib/logger.ts reads the active span).
 *
 * One catch: Next runs the proxy by passing the request through handleRequest
 * a first time, and that pass ends by throwing a "bubbled" result, which marks
 * the span `next.bubble`. Its status code is meaningless (the response isn't
 * written yet), so it is not logged. Requests the proxy answers itself are
 * logged in proxy.ts.
 *
 * Spans are only turned into log lines here; nothing is exported or retained.
 */

const REQUEST_SPAN = 'BaseServer.handleRequest';

const HTTP_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);

function methodLabel(value: unknown) {
    const method = typeof value === 'string' ? value.toUpperCase() : '';
    return HTTP_METHODS.has(method) ? method : 'OTHER';
}

/** Route pattern from Next, or a coarse bucket for requests no route claimed. */
function routeLabel(route: unknown, target: unknown) {
    if (typeof route === 'string' && route) return route;
    const path = typeof target === 'string' ? target : '';
    if (path.startsWith('/_next/static/')) return '/_next/static';
    if (path.startsWith('/_next/image')) return '/_next/image';
    if (path.startsWith('/_next/')) return '/_next';
    return '(unmatched)';
}

// Health checks arrive every few minutes; logging them would bury real traffic.
const UNLOGGED_ROUTES = new Set(['/api/health', '/api/health/live', '/api/health/ready']);

function shouldLog(route: string) {
    return !route.startsWith('/_next') && !UNLOGGED_ROUTES.has(route);
}

class RequestLogProcessor implements SpanProcessor {
    onStart() {
        // Logged once it ends, with its outcome.
    }

    onEnd(span: ReadableSpan) {
        if (span.attributes['next.span_type'] !== REQUEST_SPAN || span.attributes['next.bubble'] === true) return;

        const route = routeLabel(span.attributes['next.route'], span.attributes['http.target']);
        if (!shouldLog(route)) return;

        const [seconds, nanos] = span.duration;
        const status = Number(span.attributes['http.status_code'] ?? 0);
        // The proxy started this trace, so its ID is the request's X-Request-Id.
        logger[status >= 500 ? 'error' : 'info']('request', {
            requestId: span.spanContext().traceId,
            method: methodLabel(span.attributes['http.method']),
            route,
            status,
            durationMs: Math.round((seconds + nanos / 1e9) * 1000),
        });
    }

    forceFlush() {
        return Promise.resolve();
    }

    shutdown() {
        return Promise.resolve();
    }
}

const globalForTracing = globalThis as typeof globalThis & { __splititRequestLog?: boolean };

export function startRequestLog() {
    if (globalForTracing.__splititRequestLog) return;
    globalForTracing.__splititRequestLog = true;

    const provider = new NodeTracerProvider({
        // Every request must be logged, so an incoming `traceparent` marked
        // unsampled must not be able to switch recording off.
        sampler: new AlwaysOnSampler(),
        spanProcessors: [new RequestLogProcessor()],
    });
    // Installs the AsyncLocalStorage context manager Next needs to attach the
    // route pattern to the request span.
    provider.register();
}
