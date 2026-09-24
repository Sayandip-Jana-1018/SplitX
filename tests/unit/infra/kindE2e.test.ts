import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CLUSTER_KEYS } from '@/lib/ops/cluster';
import {
    deliveryState, E2E_OPERATOR, e2eEnvironment, envLine, FROM_REPOSITORY, OPTIONAL, pickRelease, READINGS_ON_AWS_ONLY, READINGS_ON_KIND, relayVerdict,
} from '../../../scripts/lib/e2e.mjs';
import { columns, parseMeminfo, parseMemoryStat, summarise } from '../../../scripts/lib/memory.mjs';
import { powerSource } from '../../../scripts/lib/power.mjs';

/*
 * The Kind end-to-end run on GitHub's runners (kind-e2e.yml, D-099). The run
 * itself needs a cluster; what decides something in it is checked here.
 */

const read = (path: string) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const DIGEST = (c: string) => 'ghcr.io/sayandip-jana-1018/splitx@sha256:' + c.repeat(64);

describe("the run's .env", () => {
    const repository = { SMEE_URL: 'https://smee.io/channel', GITHUB_WEBHOOK_SECRET: 'webhook', JENKINS_GITHUB_TOKEN: 'token' };

    it('makes every password and token the cluster needs, fresh for the run', () => {
        const { values, missing } = e2eEnvironment(repository, (key: string) => 'made-' + key);
        expect(missing).toEqual([]);
        for (const key of ['NEXTAUTH_SECRET', 'POSTGRES_PASSWORD', 'REDIS_PASSWORD', 'METRICS_TOKEN', 'GF_ADMIN_PASSWORD', 'JENKINS_ADMIN_PASSWORD',
            'JENKINS_TRIGGER_TOKEN', 'NEXUS_ADMIN_PASSWORD', 'NEXUS_JENKINS_PASSWORD', 'NEXUS_OPS_PASSWORD']) {
            expect(values[key]).toBe('made-' + key);
        }
        expect(values.OPS_ADMINS).toBe(E2E_OPERATOR.provider + ':' + E2E_OPERATOR.accountId);
    });

    it("takes the webhook's channel, secret and the token from the repository, and says which are missing", () => {
        expect(e2eEnvironment(repository).values).toMatchObject(repository);
        expect(e2eEnvironment({ JENKINS_GITHUB_TOKEN: 'token' }).missing).toEqual(['SMEE_URL', 'GITHUB_WEBHOOK_SECRET']);
        expect(FROM_REPOSITORY).toEqual(['SMEE_URL', 'GITHUB_WEBHOOK_SECRET', 'JENKINS_GITHUB_TOKEN']);
    });

    it('passes the alert email settings on only when the repository has them', () => {
        expect(Object.keys(e2eEnvironment(repository).values)).not.toContain('ALERT_SMTP_PASSWORD');
        const withEmail = e2eEnvironment({ ...repository, ALERT_SMTP_USERNAME: 'u', ALERT_SMTP_PASSWORD: 'p', ALERT_EMAIL_TO: 't' }).values;
        for (const key of OPTIONAL) expect(withEmail[key]).toBeDefined();
    });

    it('makes a different secret every time', () => {
        expect(e2eEnvironment(repository).values.NEXTAUTH_SECRET).not.toBe(e2eEnvironment(repository).values.NEXTAUTH_SECRET);
    });

    it('writes plain values bare, quotes the rest, and refuses a line break', () => {
        expect(envLine('SMEE_URL', 'https://smee.io/AbC-12_x')).toBe('SMEE_URL=https://smee.io/AbC-12_x');
        expect(envLine('ALERT_SMTP_PASSWORD', 'abcd efgh #1')).toBe('ALERT_SMTP_PASSWORD="abcd efgh #1"');
        expect(() => envLine('BAD', 'a\nb')).toThrow(/line break/);
    });
});

describe('the release a run takes', () => {
    const announced = [
        { id: 9, sha: 'e2e0000', environment: 'kind', creator: { login: 'someone' }, payload: { image: DIGEST('a'), ops_image: DIGEST('b') } },
        { id: 8, sha: 'newer00', environment: 'kind', creator: { login: 'github-actions[bot]' }, payload: { image: DIGEST('c'), ops_image: DIGEST('d') } },
        { id: 7, sha: 'noops00', environment: 'kind', creator: { login: 'github-actions[bot]' }, payload: { image: DIGEST('e') } },
        { id: 6, sha: 'older00', environment: 'kind', creator: { login: 'github-actions[bot]' }, payload: JSON.stringify({}) },
        { id: 5, sha: 'oldest0', environment: 'kind', creator: { login: 'github-actions[bot]' }, payload: { image: DIGEST('f'), ops_image: DIGEST('0') } },
        { id: 4, sha: 'tagged0', environment: 'kind', creator: { login: 'github-actions[bot]' }, payload: { image: 'ghcr.io/sayandip-jana-1018/splitx:latest', ops_image: DIGEST('1') } },
    ];

    it("is the newest one the release job announced with both signed images, by digest", () => {
        expect(pickRelease(announced)).toEqual({ sha: 'newer00', image: DIGEST('c'), opsImage: DIGEST('d'), announcedBy: 8 });
    });

    it('is the named commit when one is asked for, by a prefix of its SHA', () => {
        expect(pickRelease(announced, 'oldest')).toMatchObject({ sha: 'oldest0', image: DIGEST('f') });
    });

    it('is nothing for a commit without a whole, signed release', () => {
        expect(pickRelease(announced, 'noops')).toBeNull();
        expect(pickRelease(announced, 'tagged')).toBeNull();
        expect(pickRelease([])).toBeNull();
    });
});

describe("Jenkins' verdict on a delivery", () => {
    it('waits while there is no status, or only one in progress', () => {
        expect(deliveryState([])).toMatchObject({ done: false, state: 'none' });
        expect(deliveryState([{ state: 'in_progress', description: 'Jenkins is deploying abc' }])).toEqual({ done: false, ok: false, state: 'in_progress', said: 'Jenkins is deploying abc' });
    });

    it('ends on success, and on failure, error or a newer release superseding it', () => {
        expect(deliveryState([{ state: 'success', description: 'Deployed' }, { state: 'in_progress' }])).toMatchObject({ done: true, ok: true });
        for (const state of ['failure', 'error', 'inactive']) expect(deliveryState([{ state, description: null }])).toMatchObject({ done: true, ok: false, state, said: '' });
    });
});

describe("the relay's word on GitHub's deliveries", () => {
    // What the relay logged in run 36025050812, when the repository webhook sent a form.
    const RUN_2 = [
        '{"ts":"2026-09-24T16:16:04.959Z","level":"info","msg":"listening on the smee.io channel","service":"webhook-relay"}',
        '{"ts":"2026-09-24T16:17:13.209Z","level":"warn","msg":"the webhook must send application/json","service":"webhook-relay","event":"deployment","contentType":"application/x-www-form-urlencoded"}',
        '{"ts":"2026-09-24T16:17:13.272Z","level":"warn","msg":"delivery relayed","service":"webhook-relay","event":"deployment","delivery":"66564a10","status":403,"result":"refused"}',
    ].join('\n');

    it('names a form-encoded webhook as the reason Jenkins refused it', () => {
        const verdict = relayVerdict(RUN_2);
        expect(verdict.refused).toBe(true);
        expect(verdict.said).toMatch(/application\/x-www-form-urlencoded.*HTTP 403.*Content type to application\/json/);
    });

    it('reports any other refusal by its status, and waits while nothing has come', () => {
        expect(relayVerdict('{"msg":"delivery relayed","event":"deployment","status":0,"result":"unreachable"}')).toEqual({ refused: true, said: 'Jenkins answered HTTP 0 to GitHub\'s delivery (unreachable)' });
        expect(relayVerdict('')).toEqual({ refused: false, said: 'no deployment delivery yet' });
        expect(relayVerdict('not json\n{"msg":"delivery relayed","event":"ping","status":403,"result":"refused"}').refused).toBe(false);
        expect(relayVerdict('{"msg":"delivery relayed","event":"deployment","status":200,"result":"accepted"}')).toEqual({ refused: false, said: '1 deployment delivery(ies) accepted by Jenkins' });
    });
});

describe('what ops-verify expects of each reading', () => {
    it('names every one of the 16 readings exactly once: from Kind, or AWS only', () => {
        const named = [...READINGS_ON_KIND, ...READINGS_ON_AWS_ONLY];
        expect(new Set(named).size).toBe(named.length);
        expect([...named].sort()).toEqual([...CLUSTER_KEYS].sort());
    });
});

describe("the memory samples (B-027)", () => {
    it('reads /proc/meminfo in MB: in use, anonymous, shared, cache and swap in use', () => {
        const text = ['MemTotal:       16384000 kB', 'MemAvailable:    6144000 kB', 'Cached:          2048000 kB', 'SwapTotal:       4096000 kB',
            'SwapFree:        3072000 kB', 'AnonPages:       7168000 kB', 'Shmem:            512000 kB'].join('\n');
        expect(parseMeminfo(text)).toEqual({ total: 16000, used: 10000, anon: 7000, shmem: 500, cached: 2000, swap: 1000 });
    });

    it("reads a node's cgroup memory.stat in MB", () => {
        expect(parseMemoryStat('anon 1073741824\nfile 536870912\nkernel 1\nshmem 104857600\n')).toEqual({ anon: 1024, file: 512, shmem: 100 });
        expect(parseMemoryStat('')).toEqual({ anon: 0, file: 0, shmem: 0 });
    });

    it('lays out one column per series, and sums a run up with the biggest growth first', () => {
        expect(columns(['n1'])).toEqual(['time', 'phase', 'used', 'anon', 'shmem', 'cached', 'swap', 'n1:anon', 'n1:file', 'n1:shmem']);
        const rows = [
            { time: 't1', phase: 'before', used: '1000', swap: '0' },
            { time: 't2', phase: 'k8s:up', used: '5000', swap: '0' },
            { time: 't3', phase: 'verify', used: '4000', swap: '200' },
        ];
        expect(summarise(rows)).toEqual([
            { name: 'used', start: 1000, peak: 5000, peakPhase: 'k8s:up', peakTime: 't2', end: 4000, growth: 4000 },
            { name: 'swap', start: 0, peak: 200, peakPhase: 'verify', peakTime: 't3', end: 200, growth: 200 },
        ]);
        expect(summarise([])).toEqual([]);
    });
});

describe('power, on a GitHub-hosted runner', () => {
    it('counts only GitHub-hosted runners as mains power, since a self-hosted one could be a laptop', () => {
        expect(powerSource({ GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted' })).toMatchObject({ source: 'ac' });
        expect(powerSource({ GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'self-hosted' }).detail).not.toMatch(/GitHub-hosted/);
    });
});

describe('the workflow', () => {
    const text = read('.github/workflows/kind-e2e.yml');
    // A top-level block: from its key to the next line that starts a key or ends the file.
    const block = (key: string) => new RegExp('^' + key + ':\\n((?:[ #].*\\n|\\n)*)', 'm').exec(text)?.[1] ?? '';
    const jobEnv = (key: string) => new RegExp('^      ' + key + ': (\\S+)$', 'm').exec(text)?.[1] ?? '';
    const steps = text.split('\n      - name: ').slice(1).map((step) => ({ name: step.split('\n')[0], body: step }));

    it('asks for no more than it needs: to read the code, and to write deployments', () => {
        const granted = block('permissions').split('\n').filter((line) => /^  \w/.test(line)).map((line) => line.trim());
        expect(granted).toEqual(['contents: read', 'deployments: write']);
        expect(block('concurrency')).toContain('group: kind-e2e');
    });

    it('pins every action by commit, and every tool by version and checksum', () => {
        const actions = [...text.matchAll(/uses: (\S+)/g)].map((match) => match[1]);
        expect(actions.length).toBeGreaterThan(3);
        for (const action of actions) expect(action).toMatch(/@[0-9a-f]{40}$/);
        for (const tool of ['KIND', 'KUBECTL', 'HELM']) expect(jobEnv(tool + '_SHA256')).toMatch(/^[0-9a-f]{64}$/);
        expect(text.match(/sha256sum --check --strict/g)).toHaveLength(3);
    });

    it("installs the same kubectl and Helm as the AWS workflows, and the cosign CI signs with", () => {
        const aws = read('.github/actions/aws-terraform/action.yml');
        for (const key of ['KUBECTL_VERSION', 'KUBECTL_SHA256', 'HELM_VERSION', 'HELM_SHA256']) expect(aws).toContain(key + ': ' + jobEnv(key));
        expect(read('.github/workflows/ci.yml')).toContain('COSIGN_VERSION: ' + jobEnv('COSIGN_VERSION'));
    });

    it("hands the webhook's secrets only to the step that writes .env, under the names GitHub allows", () => {
        const holders = steps.filter((step) => /secrets\.(SMEE_URL|GIT_WEBHOOK_SECRET)/.test(step.body));
        expect(holders.map((step) => step.name)).toEqual(["Write this run's .env"]);
        // GitHub refuses secret names that start GITHUB_; .env's name is kept inside the run.
        expect([...text.matchAll(/secrets\.(\w+)/g)].map((match) => match[1]).filter((name) => name.startsWith('GITHUB_'))).toEqual([]);
        expect(holders[0].body).toContain('GITHUB_WEBHOOK_SECRET: ${{ secrets.GIT_WEBHOOK_SECRET }}');
    });

    it('runs scripts that exist', () => {
        const scripts = [...text.matchAll(/node (scripts\/[\w/.-]+\.mjs)/g)].map((match) => match[1]);
        expect(scripts.length).toBeGreaterThan(5);
        for (const script of scripts) expect(existsSync(script)).toBe(true);
    });
});
