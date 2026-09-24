import { readSource, recentReading, type Reading } from './reading';

/**
 * The cluster half of /ops (D-097), read from ops-api inside the cluster the
 * app runs in, at OPS_API_URL (k8s/base/config.env sets it for every cluster).
 * Vercel has no cluster beside it and no OPS_API_URL, so there /ops says the
 * cluster is not connected instead of showing anything made up.
 *
 * ops-api reads each source itself (ops/api/server.mjs) and answers with one
 * reading per source; the shapes below are what its summaries return
 * (ops/api/summaries.mjs, ops/lab/limits.mjs).
 */

export const CLUSTER_KEY = 'ops:cluster';
const TTL_MS = 4_000;
const TIMEOUT_MS = 8_000;
const SOURCE = 'ops-api in the cluster';

export const NOT_CONNECTED = 'Not connected here: the cluster runs on AWS on demo days, and on Kind in CI.';

export interface NodeRow {
    name: string;
    zone: string | null;
    instanceType: string | null;
    ready: boolean;
    cpuPercent: number | null;
    memoryPercent: number | null;
    since: string | null;
}

export interface PodRow {
    name: string;
    node: string | null;
    zone: string | null;
    phase: string;
    ready: boolean;
    restarts: number;
    digest: string | null;
    since: string | null;
}

export interface Autoscaler {
    min: number | null;
    max: number | null;
    current: number | null;
    desired: number | null;
    cpuTargetPercent: number | null;
    cpuNowPercent: number | null;
    lastScaled: string | null;
}

export interface Chart {
    title: string;
    unit: string;
    /** The Grafana panel with the same query (monitoring/dashboards/splitx-service.json). */
    panel: string;
    /** [unix seconds, value]; null where Prometheus has no value. */
    points: [number, number | null][];
}

export const CHART_KEYS = ['requests', 'p95', 'errors', 'readyPods', 'wantedPods'] as const;
export type ChartKey = (typeof CHART_KEYS)[number];

export interface Traffic {
    from: number;
    to: number;
    step: number;
    charts: Record<ChartKey, Chart>;
}

export interface LabSummary {
    requests: number;
    served: number;
    refused: number;
    failed: number;
    p95Ms: number | null;
}

export interface LabRun {
    state: 'idle' | 'running' | 'stopping' | 'stopped' | 'finished' | 'failed';
    target: string;
    rate?: number;
    seconds?: number;
    startedAt?: string;
    finishedAt?: string | null;
    elapsedSeconds?: number;
    summary?: LabSummary | null;
    error?: string | null;
}

export interface AlertRow {
    name: string;
    severity: string;
    namespace: string | null;
    since: string | null;
    summary: string;
}

export interface LogLine {
    time: string;
    level: string | null;
    message: string;
    requestId: string | null;
    pod: string | null;
}

export interface EvidenceRow {
    commit: string;
    deployment: string;
    files: string[];
    storedAt: string | null;
    complete: boolean;
}

export interface StackRow {
    name: string;
    status: string;
    updatedAt: string | null;
    drift: string;
    driftCheckedAt: string | null;
}

export interface EksSummary {
    name: string;
    version: string;
    platformVersion: string | null;
    status: string;
    authenticationMode: string | null;
    nodegroups: { name: string; status: string; instanceTypes: string[]; min: number | null; max: number | null; desired: number | null }[];
    addons: { name: string; version: string; status: string }[];
}

export interface EdgeSummary {
    id: string;
    domain: string;
    status: string;
    enabled: boolean;
    online: boolean;
    origin: string;
    httpVersion: string | null;
    priceClass: string | null;
    lastModified: string | null;
}

export interface BudgetSummary {
    name: string;
    unit: string;
    limit: number | null;
    actual: number | null;
    forecast: number | null;
}

export interface PlatformFacts {
    target: string;
    region: string | null;
    kubernetesVersion: string | null;
    vpcCidr: string | null;
    serviceCidr: string | null;
    edge: string | null;
}

export interface ClusterReadings {
    nodes: Reading<NodeRow[]>;
    workloads: Reading<PodRow[]>;
    autoscaler: Reading<Autoscaler>;
    admissions: Reading<{ allowed: number; refused: number }>;
    traffic: Reading<Traffic>;
    servingPods: Reading<{ pod: string; rate: number }[]>;
    lab: Reading<LabRun>;
    alerts: Reading<AlertRow[]>;
    logs: Reading<LogLine[]>;
    delivery: Reading<{ lastResult: string | null; lastSeconds: number | null }>;
    evidence: Reading<EvidenceRow[]>;
    stacks: Reading<StackRow[]>;
    eks: Reading<EksSummary>;
    edge: Reading<EdgeSummary>;
    budget: Reading<BudgetSummary>;
    platform: Reading<PlatformFacts>;
}

export const CLUSTER_KEYS = [
    'nodes', 'workloads', 'autoscaler', 'admissions', 'traffic', 'servingPods', 'lab', 'alerts',
    'logs', 'delivery', 'evidence', 'stacks', 'eks', 'edge', 'budget', 'platform',
] as const satisfies readonly (keyof ClusterReadings)[];

/** ops-api's origin when this deployment has a cluster beside it; null otherwise. */
export function opsApiUrl(value = process.env.OPS_API_URL): string | null {
    if (!value) return null;
    try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : null;
    } catch {
        return null;
    }
}

function isReading(value: unknown): boolean {
    if (!value || typeof value !== 'object') return false;
    const reading = value as Record<string, unknown>;
    return typeof reading.ok === 'boolean' && typeof reading.source === 'string' && typeof reading.fetchedAt === 'string'
        && (reading.ok ? 'data' in reading : typeof reading.error === 'string');
}

/**
 * Everything ops-api reads, at most a few seconds old. If ops-api itself can't
 * be reached, that is one reading saying why; each of its sources reports its
 * own availability inside.
 */
export function readCluster(): Promise<Reading<ClusterReadings>> {
    const base = opsApiUrl();
    if (!base) return Promise.resolve({ ok: false, source: SOURCE, fetchedAt: new Date().toISOString(), error: NOT_CONNECTED });
    return recentReading(CLUSTER_KEY, TTL_MS, () => readSource(SOURCE, async () => {
        const response = await fetch(`${base}/v1/readings`, { cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) }).catch((error: unknown) => {
            if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) throw error;
            const cause = error instanceof Error ? (error.cause as { code?: string } | undefined)?.code ?? error.message : 'no answer';
            throw new Error(`ops-api could not be reached (${cause})`);
        });
        if (!response.ok) throw new Error(`ops-api answered ${response.status}`);
        const body = (await response.json()) as Record<string, unknown> | null;
        const missing = CLUSTER_KEYS.filter((key) => !isReading(body?.[key]));
        if (missing.length) throw new Error(`ops-api's answer has no reading for ${missing.join(', ')}`);
        // Only the readings this page knows, passed on as ops-api gave them.
        return Object.fromEntries(CLUSTER_KEYS.map((key) => [key, body![key]])) as unknown as ClusterReadings;
    }));
}

export interface LabSettings {
    rate: number;
    seconds: number;
}

/**
 * Starts (POST) or stops (DELETE) a traffic lab run through ops-api, which
 * alone may reach the lab. Returns ops-api's status code and answer as they
 * are: the lab's state, or why it refused.
 */
export async function commandLab(method: 'POST' | 'DELETE', settings?: LabSettings): Promise<{ status: number; body: unknown }> {
    const base = opsApiUrl();
    if (!base) return { status: 503, body: { error: NOT_CONNECTED } };
    const response = await fetch(`${base}/v1/traffic`, {
        method,
        headers: settings ? { 'content-type': 'application/json' } : undefined,
        body: settings ? JSON.stringify(settings) : undefined,
        cache: 'no-store',
        signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body: unknown = await response.json().catch(() => ({ error: `ops-api answered ${response.status}` }));
    return { status: response.status, body };
}
