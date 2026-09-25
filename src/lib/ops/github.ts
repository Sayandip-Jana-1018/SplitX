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
    if (!response.ok) throw new Error(await refusal(response));
    return (await response.json()) as T;
}

/**
 * A refused request in GitHub's own words, which say what to fix: "GitHub
 * answered 403: Dependabot alerts are disabled for this repository".
 */
async function refusal(response: Response): Promise<string> {
    const body = (await response.json().catch(() => null)) as { message?: unknown } | null;
    const message = typeof body?.message === 'string' ? body.message.trim().slice(0, 200) : '';
    const words = message.endsWith('.') ? message.slice(0, -1) : message;
    return words ? `GitHub answered ${response.status}: ${words}` : `GitHub answered ${response.status}`;
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

export interface SiteChecks {
    /** GitHub's verdict on the newest finished run: success when the live site passed every check. */
    conclusion: string | null;
    /** When that run finished. */
    at: string;
    url: string;
}

/**
 * The newest finished run of the production checks (.github/workflows/uptime.yml,
 * D-106): whether the live site answered every check. Null before the first run.
 */
export function readSiteChecks(): Promise<Reading<SiteChecks | null>> {
    return recentReading('github:site-checks', TTL_MS, () => readSource('GitHub Actions: Production checks', async () => {
        const { workflow_runs: [run] } = await github<{ workflow_runs: WorkflowRun[] }>('/actions/workflows/uptime.yml/runs?branch=main&status=completed&per_page=1');
        return run ? { conclusion: run.conclusion, at: run.updated_at, url: run.html_url } : null;
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

interface CodeScanningAnalysis {
    tool: { name: string };
    commit_sha: string;
    created_at: string;
    error?: string;
}

/** A tool's newest analysis of main: which commit, when, and its error, if it reported one. */
export interface ToolScan {
    commit: string;
    at: string;
    error: string | null;
}

export interface CodeScanning {
    /** Open alerts per tool: CodeQL for the code, Trivy for the released image. */
    tools: Record<string, AlertCounts>;
    /** More than one page of alerts exists: the counts are a floor. */
    capped: boolean;
    /**
     * Each tool's newest analysis of main. A tool without one has never
     * reported, so the page says so instead of showing "no open alerts".
     */
    scans: Record<string, ToolScan>;
}

/** Open code scanning alerts by tool and severity, and each tool's newest analysis of main. */
export function readCodeScanning(): Promise<Reading<CodeScanning>> {
    return recentReading('github:code-scanning', TTL_MS, () => readSource('GitHub code scanning', async () => {
        const [alerts, analyses] = await Promise.all([
            github<CodeScanningAlert[]>('/code-scanning/alerts?state=open&per_page=100'),
            github<CodeScanningAnalysis[]>('/code-scanning/analyses?ref=refs/heads/main&per_page=50'),
        ]);
        const byTool = new Map<string, CodeScanningAlert[]>();
        for (const alert of alerts) byTool.set(alert.tool.name, [...(byTool.get(alert.tool.name) ?? []), alert]);
        const scans = new Map<string, ToolScan>();
        for (const analysis of analyses) {
            const newest = scans.get(analysis.tool.name);
            if (newest && newest.at >= analysis.created_at) continue;
            scans.set(analysis.tool.name, { commit: analysis.commit_sha, at: analysis.created_at, error: analysis.error || null });
        }
        return {
            tools: Object.fromEntries([...byTool].map(([tool, list]) => [
                tool,
                countBySeverity(list, (alert) => alert.rule.security_severity_level ?? alert.rule.severity),
            ])),
            capped: alerts.length === 100,
            scans: Object.fromEntries(scans),
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
    creator?: { login?: string } | null;
    performed_via_github_app?: { name?: string } | null;
}

export interface Delivery {
    environment: string;
    /** Who deploys this environment, from GitHub's record of the deployment (deployerOf). */
    deployer: string;
    sha: string;
    /** The signed image the release asked for, `ghcr.io/...@sha256:...`. */
    image: string | null;
    createdAt: string;
    /** The deployer's newest status: success, failure, in_progress… or null when none yet. */
    state: string | null;
    description: string | null;
    reportedAt: string | null;
}

/**
 * The environments the release job hands to Jenkins: it creates their
 * deployments in ci.yml and Jenkins reports on them (a unit test keeps the two
 * in step).
 */
export const JENKINS_ENVIRONMENTS: readonly string[] = ['kind', 'eks'];

const BOTS = new Map([
    ['vercel[bot]', 'Vercel'],
    ['github-actions[bot]', 'GitHub Actions'],
]);

/**
 * Who deploys an environment, from GitHub's own record: Jenkins for the ones
 * the release job hands it; otherwise the app that created the deployment
 * (Vercel's bot, or GitHub Actions running a job in that environment), or the
 * account that did.
 */
export function deployerOf(deployment: Pick<Deployment, 'environment' | 'creator' | 'performed_via_github_app'>): string {
    if (JENKINS_ENVIRONMENTS.includes(deployment.environment)) return 'Jenkins';
    const login = deployment.creator?.login ?? '';
    return BOTS.get(login) ?? deployment.performed_via_github_app?.name ?? (login || 'unknown');
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

/**
 * The newest deployment for each environment, and what its deployer last said
 * about it. A hundred deployments reach back past a busy week of Vercel
 * previews, so the Jenkins environments stay in view.
 */
export function readDeliveries(): Promise<Reading<Delivery[]>> {
    return recentReading('github:deliveries', TTL_MS, () => readSource('GitHub deployments', async () => {
        const deployments = await github<Deployment[]>('/deployments?per_page=100');
        const newest = new Map<string, Deployment>();
        for (const deployment of deployments) if (!newest.has(deployment.environment)) newest.set(deployment.environment, deployment);

        return Promise.all([...newest.values()].map(async (deployment) => {
            const [status] = await github<{ state: string; description: string | null; created_at: string }[]>(
                `/deployments/${deployment.id}/statuses?per_page=1`
            );
            return {
                environment: deployment.environment,
                deployer: deployerOf(deployment),
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
