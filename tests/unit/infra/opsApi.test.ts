import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHARTS, GAUGES } from '../../../ops/api/queries.mjs';
import {
    byLabel, bytes, cpuCores, scalar, series, summariseAlerts, summariseAutoscaler, summariseBudget, summariseDistribution,
    summariseEks, summariseEvidence, summariseLogs, summariseNodes, summarisePods, summariseStacks,
} from '../../../ops/api/summaries.mjs';
import { LIMITS, parseRun, summariseK6 } from '../../../ops/lab/limits.mjs';
import { cached, forget, readSource } from '../../../ops/lib/reading.mjs';
import { opsConfigMaps, opsKustomization } from '../../../scripts/lib/ops-platform.mjs';

/*
 * ops-api and the traffic lab (D-097): the cluster half of /ops. They run only
 * inside a cluster, so what can be checked without one is checked here: the
 * queries, every summary /ops shows, the lab's limits, and that the files
 * which deploy them agree with each other.
 */

const read = (path: string) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const DIGEST = 'sha256:' + 'a'.repeat(64);

interface Panel {
    title?: string;
    panels?: Panel[];
    targets?: { expr?: string }[];
}

function panelExpressions(dashboard: string): Map<string, string[]> {
    const found = new Map<string, string[]>();
    const walk = (panels: Panel[]) => {
        for (const panel of panels) {
            if (panel.panels) walk(panel.panels);
            if (panel.title && panel.targets) found.set(panel.title, panel.targets.map((target) => target.expr ?? ''));
        }
    };
    walk(JSON.parse(read(dashboard)).panels);
    return found;
}

describe('the charts on /ops', () => {
    it('use the Grafana service dashboard\'s own queries, word for word', () => {
        const panels = panelExpressions('monitoring/dashboards/splitx-service.json');
        for (const chart of Object.values(CHARTS)) {
            expect(panels.get(chart.panel), chart.panel).toContain(chart.expr);
        }
    });

    it('read Jenkins\' last deploy with the delivery dashboard\'s queries', () => {
        const panels = [...panelExpressions('monitoring/dashboards/splitx-delivery.json').values()].flat();
        expect(panels).toContain(GAUGES.lastDeploy);
        expect(panels).toContain(GAUGES.lastDeployMs);
    });

    it('count Kyverno\'s admissions by the label its metric really has, and Kyverno exports them', () => {
        expect(GAUGES.admissions).toBe('sum by (request_allowed) (increase(kyverno_admission_requests_total[24h]))');
        expect(read('helm/platform/kyverno.values.yaml')).toMatch(/\n {2}serviceMonitor:\n {4}enabled: true\n/);
    });
});

describe('what ops-api makes of each source', () => {
    it('reads Kubernetes quantities', () => {
        expect(cpuCores('250m')).toBeCloseTo(0.25);
        expect(cpuCores('1234567n')).toBeCloseTo(0.001234567);
        expect(cpuCores('2')).toBe(2);
        expect(bytes('512Mi')).toBe(512 * 2 ** 20);
        expect(bytes('8127276Ki')).toBe(8127276 * 1024);
        expect(bytes('1G')).toBe(1e9);
        expect(bytes('lots')).toBeNaN();
    });

    it('lists the nodes by zone, with how busy each is, and says so when metrics are missing', () => {
        const nodes = summariseNodes(
            {
                items: [
                    { metadata: { name: 'b', labels: { 'topology.kubernetes.io/zone': 'ap-south-1b', 'node.kubernetes.io/instance-type': 'm7i-flex.large' } }, status: { allocatable: { cpu: '2', memory: '8Gi' }, conditions: [{ type: 'Ready', status: 'True' }] } },
                    { metadata: { name: 'a', labels: { 'topology.kubernetes.io/zone': 'ap-south-1a' } }, status: { allocatable: { cpu: '2', memory: '8Gi' }, conditions: [{ type: 'Ready', status: 'False' }] } },
                ],
            },
            { items: [{ metadata: { name: 'b' }, usage: { cpu: '500m', memory: '2Gi' } }] },
        );
        expect(nodes.map((node: { name: string }) => node.name)).toEqual(['a', 'b']);
        expect(nodes[0]).toMatchObject({ zone: 'ap-south-1a', ready: false, cpuPercent: null, memoryPercent: null });
        expect(nodes[1]).toMatchObject({ instanceType: 'm7i-flex.large', ready: true, cpuPercent: 25, memoryPercent: 25 });
    });

    it('lists the app\'s pods oldest first, leaves out the ones going away, and names the digest they run', () => {
        const pods = summarisePods(
            {
                items: [
                    { metadata: { name: 'new' }, spec: { nodeName: 'b' }, status: { phase: 'Running', startTime: '2026-09-24T10:02:00Z', conditions: [{ type: 'Ready', status: 'True' }], containerStatuses: [{ name: 'splitx', restartCount: 1, imageID: 'ghcr.io/x/splitx@' + DIGEST }] } },
                    { metadata: { name: 'old' }, spec: { nodeName: 'a' }, status: { phase: 'Running', startTime: '2026-09-24T10:00:00Z', conditions: [{ type: 'Ready', status: 'True' }], containerStatuses: [] } },
                    { metadata: { name: 'leaving', deletionTimestamp: '2026-09-24T10:03:00Z' }, spec: {}, status: {} },
                ],
            },
            [{ name: 'b', zone: 'ap-south-1b' }],
        );
        expect(pods.map((pod: { name: string }) => pod.name)).toEqual(['old', 'new']);
        expect(pods[1]).toMatchObject({ zone: 'ap-south-1b', restarts: 1, digest: 'sha256:aaaaaaaaaaaa', ready: true });
        expect(pods[0]).toMatchObject({ zone: null, digest: null });
    });

    it('reads the autoscaler\'s bounds, state and CPU target', () => {
        expect(summariseAutoscaler({
            spec: { minReplicas: 2, maxReplicas: 10, metrics: [{ type: 'Resource', resource: { name: 'cpu', target: { averageUtilization: 60 } } }] },
            status: { currentReplicas: 3, desiredReplicas: 5, lastScaleTime: '2026-09-24T10:00:00Z', currentMetrics: [{ type: 'Resource', resource: { name: 'cpu', current: { averageUtilization: 91 } } }] },
        })).toEqual({ min: 2, max: 10, current: 3, desired: 5, cpuTargetPercent: 60, cpuNowPercent: 91, lastScaled: '2026-09-24T10:00:00Z' });
    });

    it('turns Prometheus answers into numbers, keeping gaps as gaps', () => {
        expect(scalar([{ value: [1, '3.5'] }])).toBe(3.5);
        expect(scalar([{ value: [1, 'NaN'] }])).toBeNull();
        expect(scalar([])).toBeNull();
        expect(series([{ values: [[10, '1'], [25, 'NaN']] }])).toEqual([[10, 1], [25, null]]);
        expect(byLabel([{ metric: { request_allowed: 'true' }, value: [1, '12'] }, { metric: {}, value: [1, '3'] }], 'request_allowed')).toEqual({ true: 12, none: 3 });
    });

    it('shows the alerts that fire, most severe first, without the always-on Watchdog', () => {
        const alerts = summariseAlerts([
            { labels: { alertname: 'Watchdog', severity: 'none' }, status: { state: 'active' } },
            { labels: { alertname: 'SlowPlans', severity: 'warning' }, status: { state: 'active' }, startsAt: '2026-09-24T10:00:00Z', annotations: { summary: 'slow' } },
            { labels: { alertname: 'Down', severity: 'critical', namespace: 'splitx' }, status: { state: 'active' }, startsAt: '2026-09-24T10:05:00Z' },
            { labels: { alertname: 'Quiet', severity: 'critical' }, status: { state: 'suppressed' } },
        ]);
        expect(alerts.map((alert: { name: string }) => alert.name)).toEqual(['Down', 'SlowPlans']);
        expect(alerts[1].summary).toBe('slow');
    });

    it('shows the newest log lines first, reading the app\'s JSON and keeping other lines as they are', () => {
        const lines = summariseLogs([
            {
                stream: { pod: 'splitx-1' },
                values: [
                    ['1727172000000000000', JSON.stringify({ level: 'info', msg: 'request', requestId: 'r1' })],
                    ['1727172060000000000', 'plain text'],
                ],
            },
        ]);
        expect(lines[0]).toMatchObject({ message: 'plain text', level: null, pod: 'splitx-1', time: '2024-09-24T10:01:00.000Z' });
        expect(lines[1]).toMatchObject({ message: 'request', level: 'info', requestId: 'r1', time: '2024-09-24T10:00:00.000Z' });
    });

    it('groups Nexus\' evidence by deployment, newest first, and says whether each is complete', () => {
        const commit = 'b'.repeat(40);
        const evidence = summariseEvidence([
            { path: `/${commit}/7/deployment.json`, lastModified: '2026-09-24T10:00:00Z' },
            { path: `${commit}/7/sbom.cdx.json`, lastModified: '2026-09-24T10:00:01Z' },
            { path: `${commit}/7/vuln.json`, lastModified: '2026-09-24T10:00:02Z' },
            { path: `${commit}/9/deployment.json`, lastModified: '2026-09-24T11:00:00Z' },
            { path: 'stray.txt' },
        ]);
        expect(evidence.map((entry) => entry.deployment)).toEqual(['9', '7']);
        expect(evidence[1]).toMatchObject({ commit: 'b'.repeat(12), complete: true, storedAt: '2026-09-24T10:00:02Z' });
        expect(evidence[0].complete).toBe(false);
    });

    it('never passes on an ARN, the account, or the edge\'s secret origin header', () => {
        const eks = summariseEks(
            { name: 'splitx', version: '1.35', status: 'ACTIVE', arn: 'arn:aws:eks:ap-south-1:123456789012:cluster/splitx', accessConfig: { authenticationMode: 'API' } },
            [{ nodegroupName: 'main', status: 'ACTIVE', instanceTypes: ['m7i-flex.large'], scalingConfig: { minSize: 3, maxSize: 4, desiredSize: 3 }, nodegroupArn: 'arn:aws:eks:x:123456789012:nodegroup/x' }],
            [{ addonName: 'vpc-cni', addonVersion: 'v1', status: 'ACTIVE', addonArn: 'arn:aws:eks:x:123456789012:addon/x' }],
        );
        const edge = summariseDistribution({
            Id: 'E123', DomainName: 'd1.cloudfront.net', Status: 'Deployed', Enabled: true,
            Origins: { Items: [{ DomainName: 'k8s-splitx-1.ap-south-1.elb.amazonaws.com', CustomHeaders: { Items: [{ HeaderName: 'X-Origin-Verify', HeaderValue: 'the-secret' }] } }] },
        });
        const shown = JSON.stringify({ eks, edge });
        expect(shown).not.toContain('123456789012');
        expect(shown).not.toContain('arn:');
        expect(shown).not.toContain('the-secret');
        expect(shown).not.toContain('X-Origin-Verify');
        expect(edge).toMatchObject({ online: true, origin: 'the load balancer' });
        expect(summariseDistribution({ Origins: { Items: [{ DomainName: 'splitx-edge-offline.s3.ap-south-1.amazonaws.com' }] } })).toMatchObject({ online: false, origin: 'the offline page' });
    });

    it('reads the stacks\' drift and the budget as AWS reports them', () => {
        expect(summariseStacks([{ StackName: 'splitx-bootstrap', StackStatus: 'CREATE_COMPLETE', CreationTime: new Date('2026-09-23T18:07:00Z') }]))
            .toEqual([{ name: 'splitx-bootstrap', status: 'CREATE_COMPLETE', updatedAt: '2026-09-23T18:07:00.000Z', drift: 'NOT_CHECKED', driftCheckedAt: null }]);
        expect(summariseBudget({ BudgetName: 'splitx-monthly', BudgetLimit: { Amount: '15.0', Unit: 'USD' }, CalculatedSpend: { ActualSpend: { Amount: '1.23', Unit: 'USD' } } }))
            .toEqual({ name: 'splitx-monthly', unit: 'USD', limit: 15, actual: 1.23, forecast: null });
    });
});

describe('the traffic lab\'s limits', () => {
    it('runs 20 plans a second for two minutes unless asked otherwise', () => {
        expect(parseRun({})).toEqual({ rate: LIMITS.rate.default, seconds: LIMITS.seconds.default });
        expect(parseRun({ rate: 30, seconds: 180 })).toEqual({ rate: 30, seconds: 180 });
    });

    it('refuses more than 30 a second, longer than 3 minutes, fractions, and any other setting, such as a target', () => {
        for (const body of [{ rate: 31 }, { rate: 0 }, { seconds: 181 }, { seconds: 29 }, { rate: 2.5 }, { rate: '20' }, { target: 'https://example.com' }, [], 'go']) {
            expect(() => parseRun(body), JSON.stringify(body)).toThrow(RangeError);
        }
    });

    it('tells requests refused on purpose (429, 503) apart from failures in k6\'s summary', () => {
        expect(summariseK6({
            metrics: {
                http_reqs: { values: { count: 100 } },
                preview_ok: { values: { count: 90 } },
                preview_rate_limited: { values: { count: 4 } },
                preview_shed: { values: { count: 5 } },
                preview_other: { values: { count: 1 } },
                http_req_duration: { values: { 'p(95)': 812.4 } },
            },
        })).toEqual({ requests: 100, served: 90, refused: 9, failed: 1, p95Ms: 812 });
        expect(summariseK6(null)).toEqual({ requests: 0, served: 0, refused: 0, failed: 0, p95Ms: null });
    });
});

describe('ops-api\'s readings', () => {
    afterEach(() => forget());

    it('say where they came from and when, or why they are unavailable', async () => {
        expect(await readSource('A', async () => 1)).toMatchObject({ ok: true, source: 'A', data: 1, fetchedAt: expect.any(String) });
        expect(await readSource('B', async () => { throw new Error('refused'); })).toMatchObject({ ok: false, source: 'B', error: 'refused' });
        expect(await readSource('C', async () => { throw Object.assign(new Error('x'), { name: 'TimeoutError' }); })).toMatchObject({ error: 'it did not answer in time' });
    });

    it('are read once per interval however many pages ask', async () => {
        const read = vi.fn(async () => 'value');
        await Promise.all([cached('k', 5_000, read), cached('k', 5_000, read)]);
        expect(read).toHaveBeenCalledTimes(1);
        forget();
        await cached('k', 5_000, read);
        expect(read).toHaveBeenCalledTimes(2);
    });
});

describe('what cluster-up gives ops-api and the lab', () => {
    it('runs the ops image from our registry by digest only', () => {
        expect(opsKustomization('ghcr.io/sayandip-jana-1018/splitx@' + DIGEST)).toEqual({
            apiVersion: 'kustomize.config.k8s.io/v1beta1',
            kind: 'Kustomization',
            resources: ['../k8s/ops'],
            images: [{ name: 'ghcr.io/sayandip-jana-1018/splitx', digest: DIGEST }],
        });
        // k8s/ops renames `splitx-ops` first, so the pin has to match the name
        // that rule produces (D-099). CI's manifests job renders the result.
        const base = read('k8s/ops/kustomization.yaml');
        expect(base).toContain('- name: splitx-ops\n    newName: ghcr.io/sayandip-jana-1018/splitx\n');
        for (const image of ['ghcr.io/sayandip-jana-1018/splitx:ops-abc', 'docker.io/someone/splitx@' + DIGEST, 'splitx-ops']) {
            expect(() => opsKustomization(image), image).toThrow(/by|must be/);
        }
    });

    it('writes the platform\'s facts without empty values, and gives the lab an origin, never a path', () => {
        const { items } = opsConfigMaps({ facts: { PLATFORM_TARGET: 'eks', AWS_REGION: 'ap-south-1', VPC_CIDR: '' }, target: 'https://d1.cloudfront.net' });
        expect(items[0]).toMatchObject({ metadata: { name: 'platform-facts', namespace: 'ops' }, data: { PLATFORM_TARGET: 'eks', AWS_REGION: 'ap-south-1' } });
        expect(items[0].data).not.toHaveProperty('VPC_CIDR');
        expect(items[1]).toMatchObject({ metadata: { name: 'traffic-lab', namespace: 'ops' }, data: { target: 'https://d1.cloudfront.net' } });
        for (const target of ['https://d1.cloudfront.net/api', 'ftp://x', 'd1.cloudfront.net']) {
            expect(() => opsConfigMaps({ facts: {}, target }), target).toThrow(/origin/);
        }
    });
});

describe('the files that deploy ops-api and the lab', () => {
    const opsApi = read('k8s/ops/ops-api.yaml');
    const lab = read('k8s/ops/traffic-lab.yaml');
    const policies = read('k8s/ops/networkpolicy.yaml');

    it('run both as restricted pods: non-root, read-only, no privileges', () => {
        for (const manifest of [opsApi, lab]) {
            expect(manifest).toContain('runAsNonRoot: true');
            expect(manifest).toContain('readOnlyRootFilesystem: true');
            expect(manifest).toContain('allowPrivilegeEscalation: false');
            expect(manifest).toMatch(/drop: \["ALL"\]/);
            expect(manifest).toContain('type: RuntimeDefault');
        }
        expect(read('helm/platform/namespaces.yaml')).toMatch(/name: ops\n {2}labels:[\s\S]*?pod-security\.kubernetes\.io\/enforce: restricted/);
    });

    it('never let ops-api read Secrets, and give the lab no Kubernetes credentials at all', () => {
        expect(opsApi).toMatch(/kind: ClusterRole\n {2}name: view/);
        expect(opsApi).not.toMatch(/resources: \[[^\]]*secrets/);
        expect(lab).toContain('automountServiceAccountToken: false');
    });

    it('let only the app reach ops-api, and only ops-api reach the lab', () => {
        expect(policies).toMatch(/name: ops-api[\s\S]*?ingress:\n\s+- from:\n[\s\S]*?kubernetes\.io\/metadata\.name: splitx\n\s+podSelector:\n\s+matchLabels:\n\s+app\.kubernetes\.io\/name: splitx/);
        expect(policies).toMatch(/name: traffic-lab[\s\S]*?ingress:\n\s+- from:\n\s+- podSelector:\n\s+matchLabels:\n\s+app\.kubernetes\.io\/name: ops-api/);
        expect(read('k8s/base/networkpolicy.yaml')).toMatch(/app\.kubernetes\.io\/name: ops-api\n\s+ports:\n\s+- port: 8080/);
        expect(read('k8s/base/config.env')).toContain('OPS_API_URL=http://ops-api.ops.svc.cluster.local:8080');
    });

    it('check the ops image\'s signature at admission, as the app\'s', () => {
        expect(read('policy/verify-release.yaml')).toMatch(/key: kubernetes\.io\/metadata\.name\n\s+operator: In\n\s+values: \[splitx, ops\]/);
    });

    it('build, scan and sign the ops image with every release, and hand it on to aws-up', () => {
        const ci = read('.github/workflows/ci.yml');
        expect(ci).toContain('targets: release,ops-release');
        expect(ci).toContain('ops-release.tags=${{ env.IMAGE }}:ops-${{ steps.provenance.outputs.git_sha }}');
        // The same gate for both images; only the ops image may use its reviewed exceptions.
        expect(ci).toMatch(/\n\s+scan "\$REF"\n/);
        expect(ci).toMatch(/\n\s+scan --ignorefile \/ops\/\.trivyignore\.yaml "\$OPS_REF"\n/);
        expect(ci.match(/--ignorefile/g)).toHaveLength(1);
        expect(ci).toContain('cosign sign --yes "$REF" "$OPS_REF"');
        expect(ci.match(/payload: \{image: \$image, ops_image: \$ops\}/g)).toHaveLength(2);
        expect(ci).toMatch(/for kustomization in [^\n]* k8s\/ops; do/);
        const up = read('.github/workflows/aws-up.yml');
        expect(up).toContain('.payload.ops_image // "none"');
        expect(up).toContain('--ops-image "$OPS_IMAGE"');
        expect(read('docker-bake.hcl')).toMatch(/target "ops-release" \{\n {2}inherits = \["ops"\]/);
    });

    it('accept a vulnerability in the ops image only with one file, a reason and an expiry', () => {
        const entries = read('ops/.trivyignore.yaml').split(/\n {2}- id: /).slice(1);
        expect(entries.length).toBeGreaterThan(0);
        for (const entry of entries) {
            const id = entry.split('\n')[0];
            expect(id, 'an id').toMatch(/^(CVE|GHSA)-[\w-]+$/);
            // Exactly one path: never a whole image, never every file.
            expect(entry.match(/^ {6}- \S+$/gm), id + ': one path').toHaveLength(1);
            expect(entry, id + ': the path').toMatch(/\n {4}paths:\n {6}- usr\/local\/bin\/k6\n/);
            expect(entry, id + ': a statement').toMatch(/\n {4}statement: >-\n {6}\S/);
            const expires = entry.match(/\n {4}expired_at: (\d{4}-\d{2}-\d{2})/)?.[1];
            expect(expires, id + ': an expiry').toBeDefined();
            // No acceptance outlives the AWS account's Free plan, the demo's deadline (D-095).
            expect(expires! <= '2026-10-31', id + ': expires by the end of October').toBe(true);
        }
    });

    it('give ops-api the role Terraform associates with it', () => {
        expect(read('terraform/platform/workloads.tf')).toMatch(/namespace\s+= "ops"\n\s+service_account = "ops-api"/);
        expect(opsApi).toMatch(/kind: ServiceAccount\nmetadata:\n[\s\S]*?name: ops-api/);
    });

    it('build the ops image the way the app\'s is built: the same patched Alpine, the node binary, no npm', () => {
        const ops = read('ops/Dockerfile');
        const app = read('Dockerfile');
        const pin = (file: string, name: string) => file.match(new RegExp(`^ARG ${name}=(\\S+)$`, 'm'))?.[1];
        expect(pin(ops, 'NODE_IMAGE')).toMatch(/^node:[\w.-]+@sha256:[0-9a-f]{64}$/);
        expect(pin(ops, 'NODE_IMAGE')).toBe(pin(app, 'NODE_IMAGE'));
        expect(pin(ops, 'RUNTIME_IMAGE')).toMatch(/^alpine:[\d.]+@sha256:[0-9a-f]{64}$/);
        expect(pin(ops, 'RUNTIME_IMAGE')).toBe(pin(app, 'RUNTIME_IMAGE'));
        expect(ops).toMatch(/^FROM \$\{RUNTIME_IMAGE\} AS runner$/m);
        expect(ops).toContain('apk upgrade --no-cache');
        expect(ops).toContain('COPY --from=node /usr/local/bin/node /usr/local/bin/node');
        // The lab runs the k6 the load tests run (scripts/load-run.mjs), by digest.
        expect(pin(ops, 'K6_IMAGE')).toMatch(/^grafana\/k6:[\d.]+@sha256:[0-9a-f]{64}$/);
        expect(pin(ops, 'K6_IMAGE')).toBe(read('scripts/load-run.mjs').match(/const K6_IMAGE = '([^']+)'/)?.[1]);
    });
});
