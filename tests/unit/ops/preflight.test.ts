import { describe, expect, it } from 'vitest';
import { NOT_CONNECTED, type ClusterReadings, type Traffic } from '@/lib/ops/cluster';
import type { CodeScanning, Delivery, Pipeline } from '@/lib/ops/github';
import { preflight, preflightHeadline, type PreflightInput, type PreflightItem } from '@/lib/ops/preflight';
import type { Reading } from '@/lib/ops/reading';

/*
 * The pre-flight list on /ops (plan Phase 9): a verdict per tool on readings
 * the page already shows. Green only when the source says so; red names what
 * to fix; nothing is decided that the sources haven't said.
 */

const at = '2026-10-10T04:00:00.000Z';
const TEN_MINUTES_BEFORE = '2026-10-10T03:50:00Z';
const ok = <T,>(data: T, source = 'a source'): Reading<T> => ({ ok: true, source, fetchedAt: at, data });
const unread = (error: string, source = 'a source'): Reading<never> => ({ ok: false, source, fetchedAt: at, error });

const SHA = 'e66a699d11640b7c44c1fa0bde969d64f3868cab';
const DIGEST = 'sha256:' + 'd'.repeat(64);
const OLD_DIGEST = 'sha256:' + 'e'.repeat(64);
const IMAGE = 'ghcr.io/sayandip-jana-1018/splitx@' + DIGEST;

const run = (overrides: Partial<Pipeline> = {}): Pipeline => ({
    commit: { sha: SHA, message: 'feat(verify): the EKS checks' },
    status: 'completed',
    conclusion: 'success',
    startedAt: at,
    updatedAt: at,
    url: 'https://github.com/Sayandip-Jana-1018/SplitX/actions/runs/1',
    jobs: [
        { name: 'verify', status: 'completed', conclusion: 'success', seconds: 300 },
        { name: 'release', status: 'completed', conclusion: 'success', seconds: 420 },
    ],
    release: { scanned: true, signed: true, attested: true },
    ...overrides,
});

const delivery = (overrides: Partial<Delivery> = {}): Delivery => ({
    environment: 'eks',
    deployer: 'Jenkins',
    sha: SHA,
    image: IMAGE,
    createdAt: at,
    state: 'success',
    description: 'Deployed e66a699d1164 and checked through the edge; evidence in Nexus',
    reportedAt: at,
    ...overrides,
});

const scanning = (overrides: Partial<CodeScanning> = {}): CodeScanning => ({
    tools: { CodeQL: { total: 1, bySeverity: { warning: 1 } }, Trivy: { total: 0, bySeverity: {} } },
    capped: false,
    scans: { CodeQL: { commit: SHA, at, error: null }, Trivy: { commit: SHA, at, error: null } },
    ...overrides,
});

const node = (name: string, zone: string | null, ready = true) => ({ name, zone, instanceType: 'm7i-flex.large', ready, cpuPercent: 20, memoryPercent: 40, since: at });
const pod = (name: string, digest = DIGEST, ready = true) => ({ name, node: 'a', zone: 'ap-south-1a', phase: 'Running', ready, restarts: 0, digest, since: at });

function readings(target = 'eks', overrides: Partial<ClusterReadings> = {}): ClusterReadings {
    return {
        nodes: ok([node('a', 'ap-south-1a'), node('b', 'ap-south-1b'), node('c', 'ap-south-1a')]),
        workloads: ok([pod('splitx-1'), pod('splitx-2')]),
        autoscaler: ok({ min: 2, max: 10, current: 2, desired: 2, cpuTargetPercent: 60, cpuNowPercent: 12, lastScaled: null }),
        admissions: ok({ allowed: 47, refused: 0 }),
        traffic: ok({ from: 0, to: 0, step: 15, charts: {} as Traffic['charts'] }),
        servingPods: ok([]),
        lab: ok({ state: 'idle', target: 'https://d1234abcd.cloudfront.net' }),
        alerts: ok([]),
        logs: ok([{ time: at, level: 'info', message: 'GET /', requestId: null, pod: 'splitx-1' }]),
        delivery: ok({ lastResult: 'success', lastSeconds: 73 }),
        evidence: ok([{ commit: SHA.slice(0, 12), deployment: '6645236192', files: ['deployment.json', 'sbom.cdx.json', 'vuln.json'], storedAt: at, complete: true }]),
        stacks: ok([
            { name: 'splitx-bootstrap', status: 'CREATE_COMPLETE', updatedAt: at, drift: 'IN_SYNC', driftCheckedAt: at },
            { name: 'splitx-guardrails', status: 'UPDATE_COMPLETE', updatedAt: at, drift: 'NOT_CHECKED', driftCheckedAt: null },
        ]),
        eks: ok({ name: 'splitx', version: '1.35', platformVersion: 'eks.3', status: 'ACTIVE', authenticationMode: 'API', nodegroups: [], addons: [] }),
        edge: ok({ id: 'E1', domain: 'd1234abcd.cloudfront.net', status: 'Deployed', enabled: true, online: true, origin: 'the load balancer', httpVersion: 'http2', priceClass: null, lastModified: at }),
        budget: ok({ name: 'splitx-monthly', unit: 'USD', limit: 15, actual: 3.2, forecast: 6.1 }),
        platform: ok({ target, region: 'ap-south-1', kubernetesVersion: 'v1.35.3', vpcCidr: '10.0.0.0/16', serviceCidr: '172.20.0.0/16', edge: 'd1234abcd.cloudfront.net' }),
        ...overrides,
    };
}

function input(overrides: Partial<PreflightInput> = {}): PreflightInput {
    return {
        pipeline: ok(run()),
        codeScanning: ok(scanning()),
        dependabot: ok({ total: 2, bySeverity: { moderate: 2 }, capped: false }),
        deliveries: ok([delivery(), delivery({ environment: 'kind' }), delivery({ environment: 'Production', deployer: 'Vercel', image: null })]),
        qualityGate: ok({ status: 'OK', conditions: [], analysis: { at, revision: SHA }, url: 'https://sonarcloud.io/project' }),
        siteChecks: ok({ conclusion: 'success', at: TEN_MINUTES_BEFORE, url: 'https://github.com/Sayandip-Jana-1018/SplitX/actions/runs/2' }),
        cluster: ok(readings()),
        ...overrides,
    };
}

const byKey = (items: PreflightItem[]) => Object.fromEntries(items.map((entry) => [entry.key, entry]));
const one = (key: string, overrides: Partial<PreflightInput>) => byKey(preflight(input(overrides)))[key];
const withCluster = (overrides: Partial<ClusterReadings>, target = 'eks') => ({ cluster: ok(readings(target, overrides)) });

describe('the pre-flight list', () => {
    it('is all green on a ready EKS platform, in the order the demo meets it', () => {
        const items = preflight(input());
        expect(items.map((entry) => entry.key)).toEqual([
            'ci', 'release', 'scanning', 'dependabot', 'sonar', 'site', 'platform', 'nodes', 'pods', 'running', 'evidence',
            'autoscaler', 'admissions', 'alerts', 'logs', 'lab', 'edge', 'stacks', 'budget',
        ]);
        expect(items.filter((entry) => entry.readiness !== 'go')).toEqual([]);
        expect(preflightHeadline(items)).toBe('All 19 ready.');
        expect(byKey(items).nodes.detail).toBe('3 ready, in ap-south-1a and ap-south-1b.');
        expect(byKey(items).platform.detail).toBe('Connected: Kubernetes on Amazon EKS.');
    });

    it('on Kind, has no AWS items, and asks no zones of the nodes', () => {
        const items = preflight(input(withCluster({ nodes: ok([node('splitx-worker', null), node('splitx-worker2', null)]) }, 'kind')));
        expect(items.map((entry) => entry.key)).not.toContain('edge');
        expect(byKey(items).nodes).toMatchObject({ readiness: 'go', detail: '2 ready.' });
        // The release it judges is the one for "kind".
        expect(byKey(items).running.readiness).toBe('go');
    });

    it('on Vercel, judges the pipeline, and says the platform is elsewhere', () => {
        const items = preflight(input({ cluster: unread(NOT_CONNECTED, 'ops-api in the cluster') }));
        expect(items).toHaveLength(7);
        expect(items[6]).toEqual({ key: 'platform', title: 'The platform', readiness: 'elsewhere', detail: NOT_CONNECTED });
        expect(preflightHeadline(items)).toBe('All 6 ready.');
    });

    it('waits for ops-api\'s first answer, and names why it can\'t be read', () => {
        expect(preflight(input({ cluster: undefined })).at(-1)).toMatchObject({ key: 'platform', readiness: 'wait' });
        expect(one('platform', { cluster: unread('ops-api could not be reached (ECONNREFUSED)', 'ops-api in the cluster') }))
            .toMatchObject({ readiness: 'fix', detail: 'ops-api in the cluster can\'t be read: ops-api could not be reached (ECONNREFUSED)' });
    });

    it('judges the live site by the newest production check, against when GitHub was read', () => {
        const checks = (conclusion: string | null, when = TEN_MINUTES_BEFORE) => ({ siteChecks: ok({ conclusion, at: when, url: 'u' }) });
        expect(one('site', {})).toMatchObject({ readiness: 'go', detail: 'Passed every production check, 10 min before this reading.' });
        expect(one('site', checks('failure'))).toMatchObject({ readiness: 'fix', detail: 'The newest production check failed: open the run, and its incident issue.' });
        expect(one('site', checks('timed_out')).detail).toBe('The newest production check timed out: open the run, and its incident issue.');
        expect(one('site', checks('cancelled')).readiness).toBe('wait');
        // Every 15 minutes, so nothing for 50 means the schedule stopped, whatever the last verdict was.
        expect(one('site', checks('success', '2026-10-10T03:10:00Z'))).toMatchObject({ readiness: 'fix' });
        expect(one('site', checks('success', '2026-10-10T03:10:00Z')).detail).toContain('No production check for 50 minutes');
        expect(one('site', { siteChecks: ok(null) })).toMatchObject({ readiness: 'wait', detail: 'The production checks haven\'t run yet.' });
        expect(one('site', { siteChecks: unread('GitHub answered 404: Not Found', 'GitHub Actions: Production checks') }))
            .toMatchObject({ readiness: 'fix', detail: 'GitHub Actions: Production checks can\'t be read: GitHub answered 404: Not Found' });
    });

    it('treats a platform it can\'t name as Kind', () => {
        const items = preflight(input(withCluster({ platform: unread('no facts') })));
        expect(byKey(items).platform.detail).toBe('Connected: Kubernetes on Kind.');
        expect(items.map((entry) => entry.key)).not.toContain('budget');
    });
});

describe('the pipeline\'s items', () => {
    it('follows CI on main', () => {
        expect(one('ci', {}).detail).toBe('e66a699 passed: 2 passed.');
        expect(one('ci', { pipeline: ok(run({ status: 'in_progress', conclusion: null })) })).toMatchObject({ readiness: 'wait', detail: 'e66a699 is in progress: 2 passed.' });
        const broken = run({ conclusion: 'failure', jobs: [{ name: 'verify', status: 'completed', conclusion: 'failure', seconds: 1 }, { name: 'release', status: 'completed', conclusion: 'skipped', seconds: null }] });
        expect(one('ci', { pipeline: ok(broken) })).toMatchObject({ readiness: 'fix', detail: 'e66a699 failure in verify: open the run, fix, and push.' });
        expect(one('ci', { pipeline: ok(run({ conclusion: 'cancelled', jobs: [] })) }).detail).toBe('e66a699 cancelled: open the run, fix, and push.');
        expect(one('ci', { pipeline: ok(null) })).toMatchObject({ readiness: 'fix', detail: 'No CI run on main yet: push to main.' });
        expect(one('ci', { pipeline: unread('OPS_GITHUB_TOKEN is not set', 'GitHub Actions') }).detail).toBe('GitHub Actions can\'t be read: OPS_GITHUB_TOKEN is not set');
    });

    it('wants the release scanned, signed and attested', () => {
        expect(one('release', { pipeline: ok(run({ release: { scanned: true, signed: false, attested: false } })) }))
            .toMatchObject({ readiness: 'fix', detail: 'e66a699: it is not signed, it is not attested. Open the release job.' });
        expect(one('release', { pipeline: ok(run({ release: { scanned: false, signed: true, attested: true } })) }).detail).toContain('the scan gate failed');
        expect(one('release', { pipeline: ok(run({ release: null, conclusion: 'failure' })) }).readiness).toBe('fix');
        expect(one('release', { pipeline: ok(run({ release: null, conclusion: null, status: 'in_progress' })) }).readiness).toBe('wait');
        expect(one('release', { pipeline: unread('down') }).readiness).toBe('wait');
    });

    it('stops at critical or high code scanning alerts, and waits for a first analysis', () => {
        const high = scanning({ tools: { CodeQL: { total: 2, bySeverity: { error: 1, high: 1 } }, Trivy: { total: 1, bySeverity: { critical: 1 } } } });
        expect(one('scanning', { codeScanning: ok(high) })).toMatchObject({ readiness: 'fix', detail: '3 critical or high alerts open: fix or dismiss them in the Security tab.' });
        expect(one('scanning', { codeScanning: ok({ ...high, capped: true }) }).detail).toMatch(/^3\+ critical/);
        expect(one('scanning', { codeScanning: ok(scanning({ scans: { CodeQL: { commit: SHA, at, error: null } } })) }))
            .toMatchObject({ readiness: 'wait', detail: 'No analysis of main yet by Trivy.' });
        expect(one('scanning', { codeScanning: unread('403') }).readiness).toBe('fix');
    });

    it('passes on GitHub\'s own words when Dependabot can\'t be read, and stops at serious advisories', () => {
        expect(one('dependabot', { dependabot: unread('Dependabot alerts are disabled for this repository.', 'GitHub Dependabot alerts') }))
            .toMatchObject({ readiness: 'fix', detail: 'GitHub Dependabot alerts can\'t be read: Dependabot alerts are disabled for this repository.' });
        expect(one('dependabot', { dependabot: ok({ total: 101, bySeverity: { critical: 1, high: 99, low: 1 }, capped: true }) }).detail)
            .toBe('100+ critical or high advisories open: update the dependencies it names.');
    });

    it('reads SonarQube Cloud\'s verdict', () => {
        const failed = { status: 'ERROR', conditions: [{ metric: 'new_coverage', status: 'ERROR', comparator: 'LT', actual: '72.4', threshold: '80' }], analysis: null, url: '' };
        expect(one('sonar', { qualityGate: ok(failed) })).toMatchObject({ readiness: 'fix', detail: 'Failed: coverage of new code 72.4 % (the gate wants at least 80.0 %).' });
        expect(one('sonar', { qualityGate: ok({ ...failed, conditions: [] }) }).detail).toBe('Failed: see its conditions.');
        expect(one('sonar', { qualityGate: ok({ ...failed, status: 'NONE' }) }).readiness).toBe('wait');
        expect(one('sonar', { qualityGate: unread('SONAR_PROJECT_KEY is not set') }).readiness).toBe('fix');
    });
});

describe('the platform\'s items', () => {
    it('stays green after the rollback rehearsal: the deployment says failure, but its image runs', () => {
        const rehearsed = delivery({ state: 'failure', description: 'Rolled back: the release never became ready' });
        expect(one('running', { deliveries: ok([rehearsed]) }).readiness).toBe('go');
    });

    it('names a release that isn\'t running, and waits while Jenkins deploys', () => {
        expect(one('running', withCluster({ workloads: ok([pod('splitx-1', OLD_DIGEST), pod('splitx-2', OLD_DIGEST)]) })))
            .toMatchObject({ readiness: 'fix', detail: 'The pods don\'t run e66a699\'s image; Jenkins reported success: "Deployed e66a699d1164 and checked through the edge; evidence in Nexus". Read its build log.' });
        expect(one('running', { deliveries: ok([delivery({ state: null, description: null })]), ...withCluster({ workloads: ok([pod('splitx-1', OLD_DIGEST)]) }) }).detail)
            .toBe('The pods don\'t run e66a699\'s image; Jenkins reported nothing. Read its build log.');
        // Mid-rollout, two images serve at once.
        expect(one('running', withCluster({ workloads: ok([pod('splitx-1'), pod('splitx-2', OLD_DIGEST)]) })).readiness).toBe('fix');
        expect(one('running', { deliveries: ok([delivery({ state: 'in_progress' })]) })).toMatchObject({ readiness: 'wait', detail: 'Jenkins is deploying e66a699.' });
        expect(one('running', { deliveries: ok([delivery({ environment: 'kind' })]) })).toMatchObject({ readiness: 'wait', detail: 'No deployment for "eks" yet: the release job announces each release.' });
        expect(one('running', { deliveries: unread('down') }).readiness).toBe('wait');
        expect(one('running', withCluster({ workloads: unread('forbidden') })).readiness).toBe('fix');
    });

    it('wants the running release\'s evidence in Nexus, complete', () => {
        expect(one('evidence', {}).detail).toBe('e66a699: deployment.json, sbom.cdx.json, vuln.json.');
        expect(one('evidence', withCluster({ evidence: ok([]) }))).toMatchObject({ readiness: 'fix', detail: 'Nothing stored for e66a699: Jenkins\' archive step says why.' });
        const partial = [{ commit: SHA.slice(0, 12), deployment: '1', files: ['deployment.json'], storedAt: at, complete: false }];
        expect(one('evidence', withCluster({ evidence: ok(partial) })).detail).toBe('e66a699 is incomplete (deployment.json): Jenkins\' archive step says why.');
        expect(one('evidence', withCluster({ evidence: ok([{ ...partial[0], files: [] }]) })).detail).toContain('(no files)');
        expect(one('evidence', { deliveries: ok([]) }).readiness).toBe('wait');
        expect(one('evidence', withCluster({ evidence: unread('401') })).readiness).toBe('fix');
    });

    it('wants every node ready, and two zones on EKS', () => {
        expect(one('nodes', withCluster({ nodes: ok([node('a', 'ap-south-1a'), node('b', 'ap-south-1b', false)]) })))
            .toMatchObject({ readiness: 'fix', detail: 'Not ready: b.' });
        expect(one('nodes', withCluster({ nodes: ok([node('a', 'ap-south-1a'), node('c', 'ap-south-1a')]) })).detail)
            .toBe('Every node is in ap-south-1a: the node group spans two.');
        expect(one('nodes', withCluster({ nodes: ok([node('a', null)]) })).detail).toBe('Every node is in one zone: the node group spans two.');
        expect(one('nodes', withCluster({ nodes: ok([]) })).detail).toBe('No nodes.');
        expect(one('nodes', withCluster({ nodes: unread('forbidden') })).readiness).toBe('fix');
    });

    it('holds the pods to the autoscaler\'s minimum', () => {
        expect(one('pods', {}).detail).toBe('2 of 2 ready.');
        expect(one('pods', withCluster({ workloads: ok([pod('splitx-1'), pod('splitx-2', DIGEST, false)]) })))
            .toMatchObject({ readiness: 'fix', detail: '1 ready, below the autoscaler\'s minimum of 2: see the pods below.' });
        expect(one('pods', withCluster({ autoscaler: unread('forbidden'), workloads: ok([pod('splitx-1')]) })).detail).toContain('minimum of 2');
        expect(one('pods', withCluster({ autoscaler: ok({ min: 3, max: 10, current: 3, desired: 3, cpuTargetPercent: 60, cpuNowPercent: 5, lastScaled: null }) })).readiness).toBe('fix');
        expect(one('pods', withCluster({ workloads: unread('forbidden') })).readiness).toBe('fix');
    });

    it('waits for the autoscaler\'s first CPU reading', () => {
        expect(one('autoscaler', {}).detail).toBe('2 pods at 12% CPU, against a 60% target.');
        const blind = { min: 2, max: 10, current: null, desired: null, cpuTargetPercent: null, cpuNowPercent: null, lastScaled: null };
        expect(one('autoscaler', withCluster({ autoscaler: ok(blind) }))).toMatchObject({ readiness: 'wait', detail: 'No CPU reading from metrics-server yet.' });
        expect(one('autoscaler', withCluster({ autoscaler: ok({ ...blind, cpuNowPercent: 3 }) })).detail).toBe('? pods at 3% CPU, against a ?% target.');
        expect(one('autoscaler', withCluster({ autoscaler: unread('forbidden') })).readiness).toBe('fix');
    });

    it('names each alert that fires, once', () => {
        const alert = (name: string) => ({ name, severity: 'warning', namespace: 'splitx', since: at, summary: 'x' });
        expect(one('alerts', withCluster({ alerts: ok([alert('KubePodNotReady'), alert('KubePodNotReady'), alert('TargetDown')]) })))
            .toMatchObject({ readiness: 'fix', detail: 'Firing: KubePodNotReady, TargetDown. Each says what is wrong below.' });
        expect(one('alerts', withCluster({ alerts: unread('down') })).readiness).toBe('fix');
    });

    it('wants the app\'s log flowing, Kyverno counted, and the lab free', () => {
        expect(one('logs', withCluster({ logs: ok([]) }))).toMatchObject({ readiness: 'fix', detail: 'No lines from the app in 15 minutes: check that Alloy is running.' });
        expect(one('logs', withCluster({ logs: unread('down') })).readiness).toBe('fix');
        expect(one('admissions', {}).detail).toBe('47 allowed and 0 refused in 24 hours.');
        expect(one('admissions', withCluster({ admissions: unread('no series') })).readiness).toBe('fix');
        expect(one('lab', withCluster({ lab: ok({ state: 'running', target: 'x' }) })).readiness).toBe('wait');
        expect(one('lab', withCluster({ lab: ok({ state: 'failed', target: 'x', error: 'k6 exited 107' }) })).detail).toBe('The last run failed: k6 exited 107. Start another to check.');
        expect(one('lab', withCluster({ lab: ok({ state: 'failed', target: 'x' }) })).detail).toBe('The last run failed. Start another to check.');
        expect(one('lab', withCluster({ lab: unread('down') })).readiness).toBe('fix');
    });
});

describe('what only EKS has', () => {
    const edge = { id: 'E1', domain: 'd1234abcd.cloudfront.net', status: 'Deployed', enabled: true, online: true, origin: 'the load balancer', httpVersion: null, priceClass: null, lastModified: null };

    it('wants CloudFront deployed, in front of the load balancer', () => {
        expect(one('edge', withCluster({ edge: ok({ ...edge, status: 'InProgress' }) })).readiness).toBe('wait');
        expect(one('edge', withCluster({ edge: ok({ ...edge, online: false, origin: 'the offline page' }) })))
            .toMatchObject({ readiness: 'fix', detail: 'd1234abcd.cloudfront.net points at the offline page: aws-up takes it online.' });
        expect(one('edge', withCluster({ edge: ok({ ...edge, enabled: false }) })).readiness).toBe('fix');
        expect(one('edge', withCluster({ edge: unread('AccessDenied') })).readiness).toBe('fix');
    });

    it('wants both stacks complete and without drift', () => {
        const stack = { name: 'splitx-bootstrap', status: 'CREATE_COMPLETE', updatedAt: at, drift: 'DRIFTED', driftCheckedAt: at };
        expect(one('stacks', withCluster({ stacks: ok([stack, { ...stack, name: 'splitx-guardrails', status: 'UPDATE_ROLLBACK_COMPLETE', drift: 'IN_SYNC' }]) })))
            .toMatchObject({ readiness: 'fix', detail: 'splitx-bootstrap: drifted; splitx-guardrails: UPDATE_ROLLBACK_COMPLETE.' });
        expect(one('stacks', withCluster({ stacks: unread('AccessDenied') })).readiness).toBe('fix');
    });

    it('says which stacks were never checked for drift, instead of that no drift was found', () => {
        expect(one('stacks', {})).toMatchObject({
            readiness: 'go',
            detail: 'splitx-bootstrap and splitx-guardrails: complete, but splitx-guardrails not yet checked for drift.',
        });
        const checked = { name: 'splitx-bootstrap', status: 'CREATE_COMPLETE', updatedAt: at, drift: 'IN_SYNC', driftCheckedAt: at };
        expect(one('stacks', withCluster({ stacks: ok([checked, { ...checked, name: 'splitx-guardrails' }]) })).detail)
            .toBe('splitx-bootstrap and splitx-guardrails: complete, and in sync when drift was last checked.');
    });

    it('warns before the budget is spent, not after', () => {
        expect(one('budget', {}).detail).toBe('3.20 USD of 15.00 USD this month.');
        expect(one('budget', withCluster({ budget: ok({ name: 'splitx-monthly', unit: 'USD', limit: 15, actual: 9, forecast: 18.5 }) })))
            .toMatchObject({ readiness: 'fix', detail: '9.00 USD spent and 18.50 USD forecast, against 15.00 USD: take the platform down after the demo.' });
        expect(one('budget', withCluster({ budget: ok({ name: 'splitx-monthly', unit: 'USD', limit: null, actual: null, forecast: null }) })).detail).toBe('? of ? this month.');
        expect(one('budget', withCluster({ budget: unread('AccessDenied') })).readiness).toBe('fix');
    });
});

describe('the headline', () => {
    it('says what stands in the way, then what is ready', () => {
        const entry = (readiness: PreflightItem['readiness']): PreflightItem => ({ key: readiness, title: readiness, readiness, detail: '' });
        expect(preflightHeadline([entry('go'), entry('fix'), entry('fix'), entry('wait')])).toBe('2 to fix, 1 waiting; 1 ready.');
        expect(preflightHeadline([entry('go'), entry('wait'), entry('elsewhere')])).toBe('1 waiting; 1 ready.');
        expect(preflightHeadline([entry('fix')])).toBe('1 to fix; 0 ready.');
    });
});
