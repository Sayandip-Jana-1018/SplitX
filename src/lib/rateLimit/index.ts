import type { NextRequest } from 'next/server';
import { logger } from '@/lib/logger';
import { metrics } from '@/lib/metrics';
import { withTimeout } from '@/lib/withTimeout';
import { clientIp } from './clientIp';
import { ipIdentity, resolveIdentity, type RequestIdentity } from './identity';
import { policyFor, type RateLimitPolicy } from './policies';
import { createRedisStore, createUpstashStore, type RateLimitStore } from './store';

/**
 * Rate limiting for API requests.
 *
 * Backend: REDIS_URL (TCP — Kubernetes, Docker) takes precedence over
 * UPSTASH_REDIS_REST_URL/TOKEN (REST — Vercel). With neither configured the
 * limiter is disabled, which is logged and exported as a metric rather than
 * silent.
 *
 * When the backend is slow or down the request is allowed ("fails open") and
 * counted as outcome="error": rate limiting protects the service, and an
 * outage of the limiter must not become an outage of the API.
 */

export type RateLimitResult =
    | { outcome: 'skip' }
    | { outcome: 'disabled'; policy: RateLimitPolicy }
    | { outcome: 'error'; policy: RateLimitPolicy; identity: RequestIdentity; error: unknown }
    | {
        outcome: 'allow' | 'deny';
        policy: RateLimitPolicy;
        identity: RequestIdentity;
        limit: number;
        remaining: number;
        resetMs: number;
    };

const BACKEND_ERROR_LOG_INTERVAL_MS = 30_000;

// Process-wide state, shared across bundles (see getStore).
const globalForLimiter = globalThis as typeof globalThis & {
    __splitxRateLimitStore?: RateLimitStore | null;
    __splitxLimiterErrorLoggedAt?: number;
};

function reportBackendError(error: unknown) {
    const now = Date.now();
    if (now - (globalForLimiter.__splitxLimiterErrorLoggedAt ?? 0) < BACKEND_ERROR_LOG_INTERVAL_MS) return;
    globalForLimiter.__splitxLimiterErrorLoggedAt = now;
    logger.warn('Rate limit backend unavailable; allowing requests', { err: error });
}

// One store per process, shared by every bundle that imports this module
// (instrumentation opens it at startup; the proxy uses it). A module-level
// variable would give each bundle its own copy and its own Redis connection.

function getStore(): RateLimitStore | null {
    if (globalForLimiter.__splitxRateLimitStore !== undefined) return globalForLimiter.__splitxRateLimitStore;

    const redisUrl = process.env.REDIS_URL;
    const upstashUrl = process.env.UPSTASH_REDIS_REST_URL;
    const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;

    let created: RateLimitStore | null = null;
    if (redisUrl) created = createRedisStore(redisUrl, reportBackendError);
    else if (upstashUrl && upstashToken) created = createUpstashStore(upstashUrl, upstashToken, reportBackendError);
    globalForLimiter.__splitxRateLimitStore = created;

    metrics.rateLimiterInfo.set({ backend: created?.backend ?? 'disabled' }, 1);
    if (!created) logger.warn('Rate limiting is disabled: set REDIS_URL or UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN');
    return created;
}

/**
 * Opens the backend connection when the server starts. Otherwise the first
 * requests reach the limiter before Redis has connected and are let through
 * unchecked — which, under autoscaling, would happen on every new pod.
 */
export function warmRateLimiter() {
    void getStore()?.warm();
}

function timeoutMs() {
    const value = Number(process.env.RATE_LIMIT_TIMEOUT_MS);
    return Number.isInteger(value) && value > 0 ? value : 300;
}

export async function checkRateLimit(request: NextRequest): Promise<RateLimitResult> {
    const policy = policyFor(request.method, request.nextUrl.pathname);
    if (!policy) return { outcome: 'skip' };

    const backend = getStore();
    if (!backend) return { outcome: 'disabled', policy };

    const ip = clientIp(request.headers);
    const identity = policy.keyBy === 'ip' ? ipIdentity(ip) : await resolveIdentity(request, ip);

    const started = performance.now();
    try {
        const hit = await withTimeout(
            backend.hit(`${policy.name}:${identity.key}`, policy.limit, policy.windowMs, Date.now()),
            timeoutMs()
        );
        metrics.rateLimitDuration.observe({ backend: backend.backend }, (performance.now() - started) / 1000);
        metrics.rateLimitChecks.inc({ policy: policy.name, outcome: hit.allowed ? 'allow' : 'deny' });
        return {
            outcome: hit.allowed ? 'allow' : 'deny',
            policy,
            identity,
            limit: policy.limit,
            remaining: Math.max(0, policy.limit - hit.count),
            resetMs: hit.resetMs,
        };
    } catch (error) {
        metrics.rateLimitDuration.observe({ backend: backend.backend }, (performance.now() - started) / 1000);
        metrics.rateLimitChecks.inc({ policy: policy.name, outcome: 'error' });
        reportBackendError(error);
        return { outcome: 'error', policy, identity, error };
    }
}

/** Test hook: use a specific store (null = disabled) or reset to environment configuration. */
export async function setRateLimitStore(next: RateLimitStore | null | undefined) {
    const current = globalForLimiter.__splitxRateLimitStore;
    if (current && current !== next) await current.close();
    globalForLimiter.__splitxRateLimitStore = next;
    globalForLimiter.__splitxLimiterErrorLoggedAt = 0;
}
