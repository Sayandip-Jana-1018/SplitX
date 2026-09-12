import { AlwaysOnSampler, NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import type { ReadableSpan, Span, SpanProcessor } from '@opentelemetry/sdk-trace-node';
import { httpMethodLabel, metrics } from '@/lib/metrics';

/**
 * HTTP RED metrics sourced from Next.js's own request span.
 *
 * Next wraps every request in a `BaseServer.handleRequest` span and, once the
 * handler has finished, stamps it with the final status code and the matched
 * route pattern (`/api/groups/[groupId]`, not the raw URL). That makes the span
 * the one place that knows the real outcome and the real duration — the proxy
 * can't, because it returns before the route handler runs.
 *
 * One catch: Next runs the proxy by passing the request through handleRequest
 * a first time, and that pass ends by throwing a "bubbled" result, which marks
 * the span `next.bubble`. Its status code is meaningless (the response isn't
 * written yet), so that span is timed as proxy work and not counted as a
 * request. Requests the proxy answers itself are counted in proxy.ts.
 *
 * Spans are only turned into metrics here; nothing is exported or retained.
 */

const REQUEST_SPAN = 'BaseServer.handleRequest';

function isRequestSpan(span: ReadableSpan) {
    return span.attributes['next.span_type'] === REQUEST_SPAN;
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

class HttpMetricsProcessor implements SpanProcessor {
    onStart(span: Span) {
        if (isRequestSpan(span)) metrics.httpRequestsInFlight.inc();
    }

    onEnd(span: ReadableSpan) {
        if (!isRequestSpan(span)) return;
        metrics.httpRequestsInFlight.dec();

        const [seconds, nanos] = span.duration;
        const elapsed = seconds + nanos / 1e9;

        if (span.attributes['next.bubble'] === true) {
            metrics.proxyDuration.observe(elapsed);
            return;
        }

        const labels = {
            method: httpMethodLabel(span.attributes['http.method']),
            route: routeLabel(span.attributes['next.route'], span.attributes['http.target']),
            status_code: String(span.attributes['http.status_code'] ?? 0),
        };
        metrics.httpRequestsTotal.inc(labels);
        metrics.httpRequestDuration.observe(labels, elapsed);
    }

    forceFlush() {
        return Promise.resolve();
    }

    shutdown() {
        return Promise.resolve();
    }
}

const globalForTracing = globalThis as typeof globalThis & { __splitxHttpMetrics?: boolean };

export function startHttpMetrics() {
    if (globalForTracing.__splitxHttpMetrics) return;
    globalForTracing.__splitxHttpMetrics = true;

    const provider = new NodeTracerProvider({
        // Every request must be counted, so an incoming `traceparent` marked
        // unsampled must not be able to switch recording off.
        sampler: new AlwaysOnSampler(),
        spanProcessors: [new HttpMetricsProcessor()],
    });
    // Installs the AsyncLocalStorage context manager Next needs to attach the
    // route pattern to the request span.
    provider.register();
}
