import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readCodeScanning, readDeliveries, readDependabot, readPipeline, RELEASE_STEPS } from '@/lib/ops/github';
import { readQualityGate } from '@/lib/ops/quality';
import { forgetReadings, readSource } from '@/lib/ops/reading';

const REPO = 'https://api.github.com/repos/Sayandip-Jana-1018/SplitX';
const SHA = '93fea82aa6a3c0ffee00000000000000000000aa';

/** GitHub's answers, by path: what the readers are given. */
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
    '/actions/workflows/codeql.yml/runs?branch=main&per_page=1': {
        workflow_runs: [{ id: 8, head_sha: SHA, display_title: 'x', status: 'completed', conclusion: 'success', run_started_at: 'x', updated_at: '2026-09-23T07:06:00Z', html_url: 'https://github.com/run/8' }],
    },
    '/dependabot/alerts?state=open&per_page=100': [{ security_advisory: { severity: 'moderate' } }],
    '/deployments?per_page=20': [
        { id: 3, sha: SHA, environment: 'kind', created_at: '2026-09-23T07:10:31Z', payload: { image: `ghcr.io/sayandip-jana-1018/splitx@sha256:${'a'.repeat(64)}` } },
        { id: 2, sha: 'older', environment: 'kind', created_at: '2026-09-22T10:00:00Z', payload: {} },
        { id: 1, sha: 'awssha', environment: 'aws', created_at: '2026-09-20T10:00:00Z', payload: JSON.stringify({ image: 'ghcr.io/x@sha256:b' }) },
    ],
    '/deployments/3/statuses?per_page=1': [],
    '/deployments/1/statuses?per_page=1': [{ state: 'success', description: 'Deployed in 177 s', created_at: '2026-09-20T10:03:00Z' }],
};

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

    it('says a source is unavailable, and why, instead of filling anything in', async () => {
        vi.stubEnv('OPS_GITHUB_TOKEN', '');
        expect(await readPipeline()).toMatchObject({ ok: false, error: 'OPS_GITHUB_TOKEN is not set' });

        forgetReadings();
        vi.stubEnv('OPS_GITHUB_TOKEN', 'token');
        fetchMock.mockResolvedValueOnce(new Response('{"message":"Resource not accessible"}', { status: 403 }));
        expect(await readPipeline()).toMatchObject({ ok: false, error: 'GitHub answered 403' });
    });

    it('matches the step names the release job really has', () => {
        const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
        for (const step of Object.values(RELEASE_STEPS)) expect(workflow).toContain(`- name: ${step}\n`);
    });
});

describe('the security readings', () => {
    it('counts open code scanning alerts per tool and severity, with the newest CodeQL run', async () => {
        const reading = await readCodeScanning();

        expect(reading.ok && reading.data).toEqual({
            tools: {
                CodeQL: { total: 1, bySeverity: { medium: 1 } },
                Trivy: { total: 3, bySeverity: { high: 2, note: 1 } },
            },
            capped: false,
            lastScan: { conclusion: 'success', at: '2026-09-23T07:06:00Z', url: 'https://github.com/run/8' },
        });
    });

    it('counts open Dependabot alerts by severity', async () => {
        const reading = await readDependabot();
        expect(reading.ok && reading.data).toEqual({ total: 1, bySeverity: { moderate: 1 }, capped: false });
    });
});

describe('the deliveries reading', () => {
    it("gives each environment's newest deployment, its image, and Jenkins' newest status", async () => {
        const reading = await readDeliveries();

        expect(reading.ok && reading.data).toEqual([
            { environment: 'kind', sha: SHA, image: `ghcr.io/sayandip-jana-1018/splitx@sha256:${'a'.repeat(64)}`, createdAt: '2026-09-23T07:10:31Z', state: null, description: null, reportedAt: null },
            { environment: 'aws', sha: 'awssha', image: 'ghcr.io/x@sha256:b', createdAt: '2026-09-20T10:00:00Z', state: 'success', description: 'Deployed in 177 s', reportedAt: '2026-09-20T10:03:00Z' },
        ]);
    });
});

describe('the quality gate reading', () => {
    it('is unavailable until the project is named', async () => {
        vi.stubEnv('SONAR_PROJECT_KEY', '');
        expect(await readQualityGate()).toMatchObject({ ok: false, error: 'SONAR_PROJECT_KEY is not set' });
    });

    it("reads SonarQube Cloud's verdict for the project", async () => {
        vi.stubEnv('SONAR_PROJECT_KEY', 'splitx');
        fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
            projectStatus: { status: 'OK', conditions: [{ metricKey: 'new_coverage', status: 'OK', actualValue: '84.1', errorThreshold: '80' }] },
        })));

        const reading = await readQualityGate();

        expect(fetchMock.mock.calls[0][0]).toBe('https://sonarcloud.io/api/qualitygates/project_status?projectKey=splitx');
        expect(reading.ok && reading.data).toEqual({
            status: 'OK',
            conditions: [{ metric: 'new_coverage', status: 'OK', actual: '84.1', threshold: '80' }],
            url: 'https://sonarcloud.io/project/overview?id=splitx',
        });
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
