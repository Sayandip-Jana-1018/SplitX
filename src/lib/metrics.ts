import client from 'prom-client';

// ═══════════════════════════════════════════════════════════════
//   SplitX — Prometheus Metrics Registry
//   Exposes application + business metrics for Prometheus scraping
// ═══════════════════════════════════════════════════════════════

// Create a dedicated registry (avoids global pollution)
export const register = new client.Registry();

// ── Default Node.js metrics (GC, event loop, memory) ──
client.collectDefaultMetrics({ register, prefix: 'splitx_' });

// ═══════════════════════════════════════════════════════════════
//   HTTP Metrics (instrumented in proxy.ts middleware)
// ═══════════════════════════════════════════════════════════════

export const httpRequestsTotal = new client.Counter({
    name: 'splitx_http_requests_total',
    help: 'Total number of HTTP requests',
    labelNames: ['method', 'route', 'status_code'] as const,
    registers: [register],
});

export const httpRequestDuration = new client.Histogram({
    name: 'splitx_http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'route', 'status_code'] as const,
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [register],
});

// ═══════════════════════════════════════════════════════════════
//   Business Metrics (incremented in API route handlers)
// ═══════════════════════════════════════════════════════════════

export const transactionsCreated = new client.Counter({
    name: 'splitx_transactions_created_total',
    help: 'Total transactions created',
    registers: [register],
});

export const settlementsCompleted = new client.Counter({
    name: 'splitx_settlements_completed_total',
    help: 'Total settlements completed',
    registers: [register],
});

export const aiChatRequests = new client.Counter({
    name: 'splitx_ai_chat_requests_total',
    help: 'Total AI chat requests processed',
    registers: [register],
});

export const receiptScans = new client.Counter({
    name: 'splitx_receipt_scans_total',
    help: 'Total receipt scans performed',
    registers: [register],
});

export const activeGroups = new client.Gauge({
    name: 'splitx_active_groups',
    help: 'Number of active groups',
    registers: [register],
});

// ═══════════════════════════════════════════════════════════════
//   Application Info
// ═══════════════════════════════════════════════════════════════

export const appInfo = new client.Gauge({
    name: 'splitx_app_info',
    help: 'Application version and metadata',
    labelNames: ['version', 'node_env'] as const,
    registers: [register],
});

// Set app info on module load
appInfo.set(
    { version: process.env.npm_package_version || '0.1.0', node_env: process.env.NODE_ENV || 'development' },
    1
);
