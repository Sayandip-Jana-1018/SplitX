import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deployerOf, JENKINS_ENVIRONMENTS, readCodeScanning, readDeliveries, readDependabot, readPipeline, readSiteChecks, RELEASE_STEPS } from '@/lib/ops/github';
import { readQualityGate } from '@/lib/ops/quality';
import { forgetReadings, readSource } from '@/lib/ops/reading';

const REPO = 'https://api.github.com/repos/Sayandip-Jana-1018/SplitX';
const SHA = '93fea82aa6a3c0ffee00000000000000000000aa';
const ANALYSES = '/code-scanning/analyses?ref=refs/heads/main&per_page=50';
const SONAR_GATE = 'https://sonarcloud.io/api/qualitygates/project_status?projectKey=splitx';
const SONAR_ANALYSES = 'https://sonarcloud.io/api/project_analyses/search?project=splitx&ps=1';
const SITE_CHECKS = '/actions/workflows/uptime.yml/runs?branch=main&status=completed&per_page=1';

/** GitHub's and SonarQube Cloud's answers, by path: what the readers are given. */
const answers: Record<string, unknown> = {
    '/actions/workflows/ci.yml/runs?branch=main&event=push&per_page=1': {
        workflow_runs: [{
            id: 7, head_sha: SHA, display_title: 'ci: CodeQL', head_commit: { message: 'ci: CodeQL, Dependabot\n\nbody' },
            status: 'completed', conclusion: 'success', run_started_at: '2026-09-23T07:03:30Z', updated_at: '2026-09-23T07:12:00Z',
            html_url: 'https://github.com/Sayandip-Jana-1018/SplitX/actions/runs/7',
        }],
    },
    '/actions/runs/7/jobs?per_page=50': {
        jobs: [
            { name: 'verify', status: 'completed', conclusion: 'success', started_at: '2026-09-23T07:03:40Z', completed_at: '2026-09-23T07:07:55Z', steps: [] },
            { name: 'sonar', status: 'completed', conclusion: 'skipped', started_at: null, completed_at: null, steps: [] },
            {
                name: 'release', status: 'completed', conclusion: 'success', started_at: '2026-09-23T07:09:00Z', completed_at: '2026-09-23T07:10:30Z',
                steps: [
                    { name: 'Scan for vulnerabilities', conclusion: 'success' },
                    { name: 'Sign', conclusion: 'success' },
                    { name: 'Attest the SBOM and the vulnerability report', conclusion: 'failure' },
                ],
            },
        ],
    },
    '/code-scanning/alerts?state=open&per_page=100': [
        { tool: { name: 'CodeQL' }, rule: { security_severity_level: 'medium', severity: 'warning' } },
        { tool: { name: 'Trivy' }, rule: { security_severity_level: 'high', severity: 'error' } },
        { tool: { name: 'Trivy' }, rule: { security_severity_level: 'high', severity: 'error' } },
        { tool: { name: 'Trivy' }, rule: { security_severity_level: null, severity: 'note' } },
    ],
    // Newest first, as GitHub lists them: CodeQL per language, and Trivy's scan of the released image.
    [ANALYSES]: [
        { tool: { name: 'CodeQL' }, commit_sha: SHA, created_at: '2026-09-23T07:06:00Z', error: '' },
        { tool: { name: 'Trivy' }, commit_sha: SHA, created_at: '2026-09-23T07:10:10Z', error: '' },
        { tool: { name: 'CodeQL' }, commit_sha: 'older', created_at: '2026-09-22T07:06:00Z', error: 'a query failed' },
    ],
    '/dependabot/alerts?state=open&per_page=100': [{ security_advisory: { severity: 'moderate' } }],
    // The production checks' newest finished run (uptime.yml, D-106).
    [SITE_CHECKS]: {
        workflow_runs: [{
            id: 9, head_sha: SHA, display_title: 'Production checks', status: 'completed', conclusion: 'failure',
            run_started_at: '2026-09-25T06:22:03Z', updated_at: '2026-09-25T06:22:40Z', html_url: 'https://github.com/Sayandip-Jana-1018/SplitX/actions/runs/9',
        }],
    },
    // As GitHub records them: the release job (github-actions[bot]) creates Jenkins' deployments, Vercel's
    // bot creates its own, and a workflow job in an environment gets one GitHub Actions creates.
    '/deployments?per_page=100': [
        { id: 3, sha: SHA, environment: 'kind', created_at: '2026-09-23T07:10:31Z', creator: { login: 'github-actions[bot]' }, payload: { image: `ghcr.io/sayandip-jana-1018/splitx@sha256:${'a'.repeat(64)}` } },
        { id: 4, sha: SHA, environment: 'Production', created_at: '2026-09-23T07:04:00Z', creator: { login: 'vercel[bot]' }, performed_via_github_app: null, payload: {} },
        { id: 5, sha: 'edgesha', environment: 'aws-demo', created_at: '2026-09-23T06:48:10Z', creator: { login: 'Sayandip-Jana-1018' }, performed_via_github_app: { name: 'GitHub Actions' }, payload: '' },
        { id: 2, sha: 'older', environment: 'kind', created_at: '2026-09-22T10:00:00Z', payload: {} },
        { id: 1, sha: 'ekssha', environment: 'eks', created_at: '2026-09-20T10:00:00Z', payload: JSON.stringify({ image: 'ghcr.io/x@sha256:b' }) },
    ],
    '/deployments/3/statuses?per_page=1': [],
    '/deployments/4/statuses?per_page=1': [{ state: 'success', description: 'Deployment has completed', created_at: '2026-09-23T07:05:00Z' }],
    '/deployments/5/statuses?per_page=1': [{ state: 'failure', description: null, created_at: '2026-09-23T06:52:00Z' }],
    '/deployments/1/statuses?per_page=1': [{ state: 'success', description: 'Deployed in 177 s', created_at: '2026-09-20T10:03:00Z' }],
    [SONAR_GATE]: {
        projectStatus: { status: 'ERROR', conditions: [{ metricKey: 'new_coverage', status: 'ERROR', comparator: 'LT', actualValue: '72.4', errorThreshold: '80' }] },
    },
    [SONAR_ANALYSES]: { analyses: [{ date: '2026-09-24T07:05:12+0000', revision: SHA }] },
};

/** Answers one test changes, put back afterwards. */
function answering(path: string, answer: unknown) {
    const saved = answers[path];
    answers[path] = answer;
    return () => {
        answers[path] = saved;
    };
}

const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (url) => {
    const path = url.startsWith(REPO) ? url.slice(REPO.length) : url;
    if (!(path in answers)) return new Response('{}', { status: 404 });
    return new Response(JSON.stringify(answers[path]), { status: 200 });
});

beforeEach(() => {
    forgetReadings();
    vi.stubEnv('OPS_GITHUB_TOKEN', 'github-read-only-token-for-tests');
    vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
});

describe('the pipeline reading', () => {
    it("reads main's newest run, its jobs, and what the release job did to the image", async () => {
        const reading = await readPipeline();

        expect(reading.ok && reading.data).toMatchObject({
            commit: { sha: SHA, message: 'ci: CodeQL, Dependabot' },
            conclusion: 'success',
            jobs: [
                { name: 'verify', conclusion: 'success', seconds: 255 },
                { name: 'sonar', conclusion: 'skipped', seconds: null },
                { name: 'release', conclusion: 'success', seconds: 90 },
            ],
            // A failed attestation step is reported as not attested, whatever the job's verdict.
            release: { scanned: true, signed: true, attested: false },
        });
        expect(reading.source).toBe('GitHub Actions: SplitX CI on main');
        expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({ authorization: 'Bearer github-read-only-token-for-tests' });
    });

    it('reads each source once per 20 seconds however many dashboards ask', async () => {
        await Promise.all([readPipeline(), readPipeline(), readPipeline()]);
        await readPipeline();

        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("says a source is unavailable, and why in GitHub's own words, instead of filling anything in", async () => {
        vi.stubEnv('OPS_GITHUB_TOKEN', '');
        expect(await readPipeline()).toMatchObject({ ok: false, error: 'OPS_GITHUB_TOKEN is not set' });

        forgetReadings();
        vi.stubEnv('OPS_GITHUB_TOKEN', 'token');
        fetchMock.mockResolvedValueOnce(new Response('{"message":"Resource not accessible"}', { status: 403 }));
        expect(await readPipeline()).toMatchObject({ ok: false, error: 'GitHub answered 403: Resource not accessible' });

        // The message says what to fix; its full stop goes, since the page ends the sentence itself.
        forgetReadings();
        fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Dependabot alerts are disabled for this repository.', status: '403' }), { status: 403 }));
        expect(await readDependabot()).toMatchObject({ ok: false, error: 'GitHub answered 403: Dependabot alerts are disabled for this repository' });

        // A body without a message still gives the status.
        forgetReadings();
        fetchMock.mockResolvedValueOnce(new Response('<html>bad gateway</html>', { status: 502 }));
        expect(await readPipeline()).toMatchObject({ ok: false, error: 'GitHub answered 502' });
    });

    it('matches the step names the release job really has', () => {
        const workflow = readFileSync('.github/workflows/ci.yml', 'utf8').replaceAll('\r\n', '\n');
        for (const step of Object.values(RELEASE_STEPS)) expect(workflow).toContain(`- name: ${step}\n`);
    });
});

describe('the security readings', () => {
    it("counts open code scanning alerts per tool and severity, with each tool's newest analysis of main", async () => {
        const reading = await readCodeScanning();

        expect(reading.ok && reading.data).toEqual({
            tools: {
                CodeQL: { total: 1, bySeverity: { medium: 1 } },
                Trivy: { total: 3, bySeverity: { high: 2, note: 1 } },
            },
            capped: false,
            scans: {
                CodeQL: { commit: SHA, at: '2026-09-23T07:06:00Z', error: null },
                Trivy: { commit: SHA, at: '2026-09-23T07:10:10Z', error: null },
            },
        });
    });

    it('keeps the newest analysis whatever order GitHub lists them in, with its error', async () => {
        const restore = answering(ANALYSES, [
            { tool: { name: 'CodeQL' }, commit_sha: 'older', created_at: '2026-09-22T07:06:00Z', error: '' },
            { tool: { name: 'CodeQL' }, commit_sha: SHA, created_at: '2026-09-23T07:06:00Z', error: 'a query failed' },
        ]);
        try {
            const reading = await readCodeScanning();
            expect(reading.ok && reading.data.scans).toEqual({ CodeQL: { commit: SHA, at: '2026-09-23T07:06:00Z', error: 'a query failed' } });
        } finally {
            restore();
        }
    });

    it('knows a tool that never analysed main has no scan, rather than no alerts', async () => {
        const restore = answering(ANALYSES, []);
        try {
            const reading = await readCodeScanning();
            expect(reading.ok && reading.data.scans).toEqual({});
        } finally {
            restore();
        }
    });

    it('counts open Dependabot alerts by severity', async () => {
        const reading = await readDependabot();
        expect(reading.ok && reading.data).toEqual({ total: 1, bySeverity: { moderate: 1 }, capped: false });
    });
});

describe('the deliveries reading', () => {
    it("gives each environment's newest deployment, who deploys it, its image, and the deployer's newest status", async () => {
        const reading = await readDeliveries();

        expect(reading.ok && reading.data).toEqual([
            { environment: 'kind', deployer: 'Jenkins', sha: SHA, image: `ghcr.io/sayandip-jana-1018/splitx@sha256:${'a'.repeat(64)}`, createdAt: '2026-09-23T07:10:31Z', state: null, description: null, reportedAt: null },
            { environment: 'Production', deployer: 'Vercel', sha: SHA, image: null, createdAt: '2026-09-23T07:04:00Z', state: 'success', description: 'Deployment has completed', reportedAt: '2026-09-23T07:05:00Z' },
            { environment: 'aws-demo', deployer: 'GitHub Actions', sha: 'edgesha', image: null, createdAt: '2026-09-23T06:48:10Z', state: 'failure', description: null, reportedAt: '2026-09-23T06:52:00Z' },
            { environment: 'eks', deployer: 'Jenkins', sha: 'ekssha', image: 'ghcr.io/x@sha256:b', createdAt: '2026-09-20T10:00:00Z', state: 'success', description: 'Deployed in 177 s', reportedAt: '2026-09-20T10:03:00Z' },
        ]);
    });

    it("names the deployer from GitHub's record of the deployment, not from the environment's name", () => {
        expect(deployerOf({ environment: 'kind', creator: { login: 'github-actions[bot]' } })).toBe('Jenkins');
        expect(deployerOf({ environment: 'Preview', creator: { login: 'vercel[bot]' } })).toBe('Vercel');
        expect(deployerOf({ environment: 'aws-demo', creator: { login: 'someone' }, performed_via_github_app: { name: 'GitHub Actions' } })).toBe('GitHub Actions');
        expect(deployerOf({ environment: 'staging', creator: { login: 'github-actions[bot]' } })).toBe('GitHub Actions');
        expect(deployerOf({ environment: 'manual', creator: { login: 'someone' } })).toBe('someone');
        expect(deployerOf({ environment: 'orphan' })).toBe('unknown');
    });

    it('hands Jenkins exactly the environments the release job creates deployments for', () => {
        const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
        const created = [...workflow.matchAll(/ref: \$sha, environment: "([a-z-]+)"/g)].map((match) => match[1]);
        expect(created.toSorted()).toEqual([...JENKINS_ENVIRONMENTS].toSorted());
    });
});

describe('the production checks reading', () => {
    it('gives the verdict of the newest finished run on main, when it ended, and where to read it', async () => {
        expect(await readSiteChecks()).toMatchObject({
            ok: true,
            source: 'GitHub Actions: Production checks',
            data: { conclusion: 'failure', at: '2026-09-25T06:22:40Z', url: 'https://github.com/Sayandip-Jana-1018/SplitX/actions/runs/9' },
        });
    });

    it('says the checks have not run yet, rather than a verdict', async () => {
        const restore = answering(SITE_CHECKS, { workflow_runs: [] });
        expect(await readSiteChecks()).toMatchObject({ ok: true, data: null });
        restore();
    });

    it('reads the workflow the unit tests hold (tests/unit/infra/uptime.test.ts)', () => {
        expect(readFileSync('.github/workflows/uptime.yml', 'utf8')).toContain('name: Production checks');
    });
});

describe('the quality gate reading', () => {
    it('is unavailable until the project is named', async () => {
        vi.stubEnv('SONAR_PROJECT_KEY', '');
        expect(await readQualityGate()).toMatchObject({ ok: false, error: 'SONAR_PROJECT_KEY is not set' });
    });

    it("reads SonarQube Cloud's verdict for the project, and the analysis it belongs to", async () => {
        vi.stubEnv('SONAR_PROJECT_KEY', 'splitx');

        const reading = await readQualityGate();

        expect(fetchMock.mock.calls.map(([url]) => url).toSorted()).toEqual([SONAR_ANALYSES, SONAR_GATE]);
        expect(reading.ok && reading.data).toEqual({
            status: 'ERROR',
            conditions: [{ metric: 'new_coverage', status: 'ERROR', comparator: 'LT', actual: '72.4', threshold: '80' }],
            // Sonar writes +0000; the page is given an ISO time.
            analysis: { at: '2026-09-24T07:05:12.000Z', revision: SHA },
            url: 'https://sonarcloud.io/summary/new_code?id=splitx',
        });
    });

    it('says when SonarQube Cloud refuses, and that a project without an analysis has none', async () => {
        vi.stubEnv('SONAR_PROJECT_KEY', 'splitx');
        fetchMock.mockResolvedValueOnce(new Response('{}', { status: 404 }));
        expect(await readQualityGate()).toMatchObject({ ok: false, error: 'SonarQube Cloud answered 404' });

        forgetReadings();
        const restore = answering(SONAR_ANALYSES, { analyses: [] });
        try {
            const reading = await readQualityGate();
            expect(reading.ok && reading.data.analysis).toBeNull();
        } finally {
            restore();
        }
    });
});

describe('readSource', () => {
    it('reports a timeout in words', async () => {
        const reading = await readSource('slow', async () => {
            throw new DOMException('The operation timed out.', 'TimeoutError');
        });
        expect(reading).toMatchObject({ ok: false, source: 'slow', error: 'it did not answer in time' });
    });
});
