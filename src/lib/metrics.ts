import client from 'prom-client';
import { CATEGORIES, PAYMENT_METHODS } from '@/lib/utils';

// ═══════════════════════════════════════════════════════════════
//   SplitX — Prometheus Metrics
//
//   Next.js compiles this module into every server entry point on its
//   own: the proxy, each route handler and instrumentation all get a
//   separate copy. A module-level registry would therefore exist once
//   per bundle, and /api/metrics would serve one that nothing writes
//   to. The whole set lives on globalThis so every bundle in the
//   process records into — and scrapes from — the same instances.
// ═══════════════════════════════════════════════════════════════

const HTTP_DURATION_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

function createMetrics() {
    const register = new client.Registry();
    client.collectDefaultMetrics({ register, prefix: 'splitx_' });

    return {
        register,

        // ── HTTP (recorded from Next.js request spans, see lib/observability/httpMetrics.ts) ──
        httpRequestsTotal: new client.Counter({
            name: 'splitx_http_requests_total',
            help: 'HTTP requests handled, by method, route pattern and final status code',
            labelNames: ['method', 'route', 'status_code'] as const,
            registers: [register],
        }),
        httpRequestDuration: new client.Histogram({
            name: 'splitx_http_request_duration_seconds',
            help: 'Time Next.js spent handling requests that reached a route, in seconds (proxy time is in splitx_proxy_duration_seconds)',
            labelNames: ['method', 'route', 'status_code'] as const,
            buckets: HTTP_DURATION_BUCKETS,
            registers: [register],
        }),
        httpRequestsInFlight: new client.Gauge({
            name: 'splitx_http_requests_in_flight',
            help: 'HTTP requests currently being handled by this process',
            registers: [register],
        }),
        proxyDuration: new client.Histogram({
            name: 'splitx_proxy_duration_seconds',
            help: 'Time spent in the Next.js proxy (auth redirects, rate limiting) per matched request, in seconds',
            buckets: HTTP_DURATION_BUCKETS,
            registers: [register],
        }),
        proxyDecisions: new client.Counter({
            name: 'splitx_proxy_decisions_total',
            help: 'What the Next.js proxy did with each matched request',
            labelNames: ['decision'] as const,
            registers: [register],
        }),

        // ── Rate limiting ──
        rateLimitChecks: new client.Counter({
            name: 'splitx_rate_limit_checks_total',
            help: 'Rate limit checks, by policy and outcome (allow, deny, or error when the backend failed and the request was let through)',
            labelNames: ['policy', 'outcome'] as const,
            registers: [register],
        }),
        rateLimitDuration: new client.Histogram({
            name: 'splitx_rate_limit_duration_seconds',
            help: 'Time spent waiting on the rate limit backend, in seconds',
            labelNames: ['backend'] as const,
            buckets: [0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
            registers: [register],
        }),
        rateLimiterInfo: new client.Gauge({
            name: 'splitx_rate_limiter_info',
            help: 'The configured rate limit backend (redis, upstash, or disabled) — 1 for the active one',
            labelNames: ['backend'] as const,
            registers: [register],
        }),

        // ── Settlement preview: pure CPU, the endpoint autoscaling is demonstrated on ──
        settlementPreviews: new client.Counter({
            name: 'splitx_settlement_previews_total',
            help: 'Settlement preview requests, by input mode and outcome (ok, invalid, too_large, shed)',
            labelNames: ['mode', 'outcome'] as const,
            registers: [register],
        }),
        settlementPreviewCompute: new client.Histogram({
            name: 'splitx_settlement_preview_compute_seconds',
            help: 'Time spent simulating and planning a settlement preview, by input mode and the algorithm that produced the plan, in seconds',
            labelNames: ['mode', 'algorithm'] as const,
            buckets: [0.0005, 0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
            registers: [register],
        }),
        settlementPreviewQueue: new client.Histogram({
            name: 'splitx_settlement_preview_queue_seconds',
            help: 'How long settlement preview requests waited in the process before being handled, in seconds',
            buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
            registers: [register],
        }),

        // ── Business events (recorded in the route handlers that cause them) ──
        transactionsCreated: new client.Counter({
            name: 'splitx_transactions_created_total',
            help: 'Expenses recorded, by how they were entered and their category',
            labelNames: ['source', 'category'] as const,
            registers: [register],
        }),
        transactionValue: new client.Counter({
            name: 'splitx_transaction_value_paise_total',
            help: 'Total value of recorded expenses, in paise',
            labelNames: ['source'] as const,
            registers: [register],
        }),
        settlementsCompleted: new client.Counter({
            name: 'splitx_settlements_completed_total',
            help: 'Settlements that reached a completed state, by payment method',
            labelNames: ['method'] as const,
            registers: [register],
        }),
        settlementValue: new client.Counter({
            name: 'splitx_settlement_value_paise_total',
            help: 'Total value of completed settlements, in paise',
            labelNames: ['method'] as const,
            registers: [register],
        }),
        aiChatRequests: new client.Counter({
            name: 'splitx_ai_chat_requests_total',
            help: 'AI assistant replies, by the provider that answered and whether it succeeded',
            labelNames: ['provider', 'outcome'] as const,
            registers: [register],
        }),
        receiptScans: new client.Counter({
            name: 'splitx_receipt_scans_total',
            help: 'Receipt scans attempted against the vision model, by outcome',
            labelNames: ['outcome'] as const,
            registers: [register],
        }),
        voiceParses: new client.Counter({
            name: 'splitx_voice_parses_total',
            help: 'Voice expense parses, by the provider that produced the result',
            labelNames: ['provider'] as const,
            registers: [register],
        }),
        activeGroups: new client.Gauge({
            name: 'splitx_active_groups',
            help: 'Groups that have not been deleted (refreshed at scrape time; identical on every pod)',
            registers: [register],
        }),

        appInfo: new client.Gauge({
            name: 'splitx_app_info',
            help: 'Build and runtime metadata for the running process',
            labelNames: ['version', 'git_sha', 'node_env'] as const,
            registers: [register],
        }),
    };
}

export type SplitXMetrics = ReturnType<typeof createMetrics>;

const globalForMetrics = globalThis as typeof globalThis & { __splitxMetrics?: SplitXMetrics };

function getMetrics(): SplitXMetrics {
    if (!globalForMetrics.__splitxMetrics) {
        const created = createMetrics();
        created.appInfo.set(
            {
                version: process.env.APP_VERSION || process.env.npm_package_version || 'dev',
                git_sha: process.env.GIT_SHA || 'unknown',
                node_env: process.env.NODE_ENV || 'development',
            },
            1
        );
        globalForMetrics.__splitxMetrics = created;
    }
    return globalForMetrics.__splitxMetrics;
}

export const metrics = getMetrics();
export const register = metrics.register;

// ═══════════════════════════════════════════════════════════════
//   Recorders — label values are normalised here so a user-supplied
//   string can never create an unbounded number of time series.
// ═══════════════════════════════════════════════════════════════

const HTTP_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);

export function httpMethodLabel(value: unknown) {
    const method = typeof value === 'string' ? value.toUpperCase() : '';
    return HTTP_METHODS.has(method) ? method : 'OTHER';
}

export type ProxyDecision = 'pass' | 'limiter_error' | 'redirect_login' | 'redirect_dashboard' | 'rate_limited';

/** Decisions where the proxy writes the response itself instead of forwarding. */
const ANSWERED_BY_PROXY = new Set<ProxyDecision>(['redirect_login', 'redirect_dashboard', 'rate_limited']);

/**
 * Requests the proxy answers itself (redirects, 429s) never reach a route, so
 * no request span reports them. They are counted here — once — with the real
 * status, which keeps splitx_http_requests_total a complete count of responses.
 */
export function recordProxyDecision(decision: ProxyDecision, method: string, status: number) {
    metrics.proxyDecisions.inc({ decision });
    if (ANSWERED_BY_PROXY.has(decision)) {
        metrics.httpRequestsTotal.inc({ method: httpMethodLabel(method), route: '(proxy)', status_code: String(status) });
    }
}

const KNOWN_CATEGORIES = new Set(Object.keys(CATEGORIES));
const KNOWN_METHODS = new Set([...Object.keys(PAYMENT_METHODS), 'upi']);

export function recordTransactionCreated(source: 'manual' | 'receipt', category: string, amountPaise: number) {
    metrics.transactionsCreated.inc({ source, category: KNOWN_CATEGORIES.has(category) ? category : 'custom' });
    if (Number.isFinite(amountPaise) && amountPaise > 0) {
        metrics.transactionValue.inc({ source }, amountPaise);
    }
}

export function recordSettlementCompleted(method: string | null | undefined, amountPaise: number) {
    const label = method && KNOWN_METHODS.has(method) ? method : 'other';
    metrics.settlementsCompleted.inc({ method: label });
    if (Number.isFinite(amountPaise) && amountPaise > 0) {
        metrics.settlementValue.inc({ method: label }, amountPaise);
    }
}

export function recordAiChat(provider: 'gemini' | 'local', outcome: 'ok' | 'error') {
    metrics.aiChatRequests.inc({ provider, outcome });
}

export function recordReceiptScan(outcome: 'success' | 'upstream_error' | 'rate_limited' | 'unparseable' | 'error') {
    metrics.receiptScans.inc({ outcome });
}

export function recordVoiceParse(provider: 'gemini' | 'gemini_fallback' | 'local') {
    metrics.voiceParses.inc({ provider });
}
