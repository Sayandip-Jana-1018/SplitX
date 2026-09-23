import { readSource, recentReading, type Reading } from './reading';

/**
 * The pipeline half of /ops, read from GitHub's API with a read-only token
 * (OPS_GITHUB_TOKEN: Actions, Contents, Deployments, Code scanning alerts and
 * Dependabot alerts, read only). It works wherever the app runs, including
 * Vercel, where no cluster exists.
 */

const TTL_MS = 20_000;

/**
 * Step names in .github/workflows/ci.yml whose outcome the page reports. A
 * unit test checks that the workflow still has them.
 */
export const RELEASE_STEPS = {
    scanned: 'Scan for vulnerabilities',
    signed: 'Sign',
    attested: 'Attest the SBOM and the vulnerability report',
} as const;

async function github<T>(path: string): Promise<T> {
    const token = process.env.OPS_GITHUB_TOKEN;
    if (!token) throw new Error('OPS_GITHUB_TOKEN is not set');
    const repository = process.env.OPS_GITHUB_REPOSITORY || 'Sayandip-Jana-1018/SplitX';
    const response = await fetch(`https://api.github.com/repos/${repository}${path}`, {
        headers: {
            accept: 'application/vnd.github+json',
            authorization: `Bearer ${token}`,
            'x-github-api-version': '2022-11-28',
            'user-agent': 'splitx-ops',
        },
        cache: 'no-store',
        signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
    return (await response.json()) as T;
}

const secondsBetween = (from?: string | null, to?: string | null) =>
    from && to ? Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 1000)) : null;

interface WorkflowRun {
    id: number;
    head_sha: string;
    display_title: string;
    head_commit?: { message: string } | null;
    status: string;
    conclusion: string | null;
    run_started_at: string;
    updated_at: string;
    html_url: string;
}

interface WorkflowJob {
    name: string;
    status: string;
    conclusion: string | null;
    started_at: string | null;
    completed_at: string | null;
    steps?: { name: string; conclusion: string | null }[];
}

export interface PipelineJob {
    name: string;
    status: string;
    conclusion: string | null;
    seconds: number | null;
}

export interface Pipeline {
    commit: { sha: string; message: string };
    status: string;
    conclusion: string | null;
    startedAt: string;
    updatedAt: string;
    url: string;
    jobs: PipelineJob[];
    /** What the release job did to this commit's image, from its own steps; null when it didn't run. */
    release: { scanned: boolean; signed: boolean; attested: boolean } | null;
}

/** The newest CI run on main, its jobs, and what its release job did. */
export function readPipeline(): Promise<Reading<Pipeline | null>> {
    return recentReading('github:pipeline', TTL_MS, () => readSource('GitHub Actions: SplitX CI on main', async () => {
        const { workflow_runs: [run] } = await github<{ workflow_runs: WorkflowRun[] }>('/actions/workflows/ci.yml/runs?branch=main&event=push&per_page=1');
        if (!run) return null;

        const { jobs } = await github<{ jobs: WorkflowJob[] }>(`/actions/runs/${run.id}/jobs?per_page=50`);
        const releaseJob = jobs.find((job) => job.name === 'release');
        const passed = (name: string) => (releaseJob?.steps ?? []).some((step) => step.name === name && step.conclusion === 'success');

        return {
            commit: { sha: run.head_sha, message: (run.head_commit?.message ?? run.display_title).split('\n')[0] },
            status: run.status,
            conclusion: run.conclusion,
            startedAt: run.run_started_at,
            updatedAt: run.updated_at,
            url: run.html_url,
            jobs: jobs.map((job) => ({
                name: job.name,
                status: job.status,
                conclusion: job.conclusion,
                seconds: secondsBetween(job.started_at, job.completed_at),
            })),
            release: releaseJob && releaseJob.conclusion !== 'skipped'
                ? { scanned: passed(RELEASE_STEPS.scanned), signed: passed(RELEASE_STEPS.signed), attested: passed(RELEASE_STEPS.attested) }
                : null,
        };
    }));
}

export interface AlertCounts {
    total: number;
    bySeverity: Record<string, number>;
}

function countBySeverity<T>(alerts: T[], severity: (alert: T) => string | null | undefined): AlertCounts {
    const counts: AlertCounts = { total: 0, bySeverity: {} };
    for (const alert of alerts) {
        const level = severity(alert) || 'unknown';
        counts.total += 1;
        counts.bySeverity[level] = (counts.bySeverity[level] ?? 0) + 1;
    }
    return counts;
}

interface CodeScanningAlert {
    tool: { name: string };
    rule: { security_severity_level?: string | null; severity?: string | null };
}

export interface CodeScanning {
    /** Open alerts per tool: CodeQL for the code, Trivy for the released image. */
    tools: Record<string, AlertCounts>;
    /** More than one page of alerts exists: the counts are a floor. */
    capped: boolean;
    lastScan: { conclusion: string | null; at: string; url: string } | null;
}

/** Open code scanning alerts by tool and severity, and the newest CodeQL run. */
export function readCodeScanning(): Promise<Reading<CodeScanning>> {
    return recentReading('github:code-scanning', TTL_MS, () => readSource('GitHub code scanning', async () => {
        const [alerts, { workflow_runs: [scan] }] = await Promise.all([
            github<CodeScanningAlert[]>('/code-scanning/alerts?state=open&per_page=100'),
            github<{ workflow_runs: WorkflowRun[] }>('/actions/workflows/codeql.yml/runs?branch=main&per_page=1'),
        ]);
        const byTool = new Map<string, CodeScanningAlert[]>();
        for (const alert of alerts) byTool.set(alert.tool.name, [...(byTool.get(alert.tool.name) ?? []), alert]);
        return {
            tools: Object.fromEntries([...byTool].map(([tool, list]) => [
                tool,
                countBySeverity(list, (alert) => alert.rule.security_severity_level ?? alert.rule.severity),
            ])),
            capped: alerts.length === 100,
            lastScan: scan ? { conclusion: scan.conclusion, at: scan.updated_at, url: scan.html_url } : null,
        };
    }));
}

/** Open Dependabot alerts on the dependencies, by severity. */
export function readDependabot(): Promise<Reading<AlertCounts & { capped: boolean }>> {
    return recentReading('github:dependabot', TTL_MS, () => readSource('GitHub Dependabot alerts', async () => {
        const alerts = await github<{ security_advisory: { severity: string } }[]>('/dependabot/alerts?state=open&per_page=100');
        return { ...countBySeverity(alerts, (alert) => alert.security_advisory.severity), capped: alerts.length === 100 };
    }));
}

interface Deployment {
    id: number;
    sha: string;
    environment: string;
    created_at: string;
    payload: unknown;
}

export interface Delivery {
    environment: string;
    sha: string;
    /** The signed image the release asked for, `ghcr.io/...@sha256:...`. */
    image: string | null;
    createdAt: string;
    /** The newest status Jenkins reported: success, failure, in_progress… or null when none yet. */
    state: string | null;
    description: string | null;
    reportedAt: string | null;
}

function imageOf(payload: unknown): string | null {
    let value = payload;
    if (typeof value === 'string') {
        try {
            value = JSON.parse(value);
        } catch {
            return null;
        }
    }
    const image = (value as { image?: unknown } | null)?.image;
    return typeof image === 'string' ? image : null;
}

/** The newest deployment for each environment, and what Jenkins last said about it. */
export function readDeliveries(): Promise<Reading<Delivery[]>> {
    return recentReading('github:deliveries', TTL_MS, () => readSource('GitHub deployments', async () => {
        const deployments = await github<Deployment[]>('/deployments?per_page=20');
        const newest = new Map<string, Deployment>();
        for (const deployment of deployments) if (!newest.has(deployment.environment)) newest.set(deployment.environment, deployment);

        return Promise.all([...newest.values()].map(async (deployment) => {
            const [status] = await github<{ state: string; description: string | null; created_at: string }[]>(
                `/deployments/${deployment.id}/statuses?per_page=1`
            );
            return {
                environment: deployment.environment,
                sha: deployment.sha,
                image: imageOf(deployment.payload),
                createdAt: deployment.created_at,
                state: status?.state ?? null,
                description: status?.description ?? null,
                reportedAt: status?.created_at ?? null,
            };
        }));
    }));
}
