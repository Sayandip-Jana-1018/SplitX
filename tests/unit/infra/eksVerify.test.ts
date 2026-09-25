import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
    checkNewConnections, DATABASE_FROM_URL, PROBE_CONTROL, policyEnforced, policyProbeScript, policyTargets, readPolicyProbe,
} from '../../../scripts/lib/cluster-network.mjs';
import {
    ALB_EXPECTED, albDecision, albFindings, autoscalerHealth, awsReadings, buildForDeployment, cosignVerification, DATABASE_PROBE, ebsFindings, eksClusterOf,
    identityProblem, INTERNAL_SPELLINGS, madeByEdgeFunction, matchesPathPattern, POD_IDENTITY_ACCOUNTS, podIdentityFindings, spreadOf,
    ungatedPods, unhealthyPods,
} from '../../../scripts/lib/platform-checks.mjs';
import { forwardedPort, KIND_ONLY, verifyTarget } from '../../../scripts/lib/verify-target.mjs';

/*
 * k8s:verify and cd:verify on EKS (D-103). Only an AWS day runs them against
 * EKS, and an AWS day costs money, so every rule they apply to what Kubernetes
 * and AWS answer is held here, against those answers' shapes, first.
 */

const read = (path: string) => readFileSync(path, 'utf8');
const ACCOUNT = '000000000000';

describe('which cluster the verifiers check', () => {
    const overlay = (url: string) => (path: string) => {
        expect(path).toBe('k8s/overlays/aws/kustomization.yaml');
        return '      - NEXTAUTH_URL=' + url + '\n';
    };

    it('is Kind unless told otherwise, exactly as before', () => {
        const kind = verifyTarget([], read);
        expect(kind).toMatchObject({ name: 'kind', context: 'kind-splitx', base: 'http://localhost', environment: 'kind', otherEnvironment: 'eks' });
        expect(kind.reports).toEqual({ cluster: 'docs/evidence/kubernetes.md', delivery: 'docs/evidence/delivery.md' });
        expect(verifyTarget(['--rollback'], read).name).toBe('kind');
    });

    it('on EKS, is reached through the edge the overlay commits, as visitors are', () => {
        const eks = verifyTarget(['--target', 'eks', '--rollback'], overlay('https://d1234abcd.cloudfront.net'));
        expect(eks).toMatchObject({
            name: 'eks', context: 'splitx', base: 'https://d1234abcd.cloudfront.net', host: 'd1234abcd.cloudfront.net',
            environment: 'eks', otherEnvironment: 'kind',
        });
        expect(eks.reports).toEqual({ cluster: 'docs/evidence/kubernetes-eks.md', delivery: 'docs/evidence/delivery-eks.md' });
        // Never Docker Hub's anonymous allowance from one NAT address.
        expect(eks.probeImage).toBe('public.ecr.aws/docker/library/busybox:1.37.0');
        expect(verifyTarget(['--target', 'eks', '--context', 'mine'], overlay('https://d1234abcd.cloudfront.net')).context).toBe('mine');
    });

    it('refuses EKS before the edge exists, and any other target', () => {
        expect(() => verifyTarget(['--target', 'eks'], read)).toThrow(/no edge address yet/);
        expect(() => verifyTarget(['--target', 'aws'], read)).toThrow(/kind \(the default\) or eks/);
    });

    it('says why each Kind-only check has nothing to check on EKS', () => {
        expect(Object.keys(KIND_ONLY).sort()).toEqual(['controlPlane', 'databaseOutage', 'ingressTrace', 'kindnet']);
        for (const reason of Object.values(KIND_ONLY)) expect(reason.length).toBeGreaterThan(40);
    });

    it('reads the local port kubectl port-forward chose', () => {
        expect(forwardedPort('Forwarding from 127.0.0.1:43127 -> 9090\nForwarding from [::1]:43127 -> 9090\n')).toBe(43127);
        expect(forwardedPort('Forwarding from [::1]:43127 -> 9090\n')).toBeNull();
        expect(forwardedPort('')).toBeNull();
    });
});

describe('where the pods run', () => {
    const node = (name: string, zone?: string) => ({ metadata: { name, labels: zone ? { 'topology.kubernetes.io/zone': zone } : {} } });
    const pod = (name: string, nodeName: string, extra: Record<string, unknown> = {}) => ({ metadata: { name, namespace: 'splitx' }, spec: { nodeName }, ...extra });

    it('counts the zones of the nodes the pods are on', () => {
        const nodes = [node('a', 'ap-south-1a'), node('b', 'ap-south-1b'), node('c', 'ap-south-1a')];
        expect(spreadOf([pod('p1', 'a'), pod('p2', 'c')], nodes)).toEqual({ nodes: ['a', 'c'], zones: ['ap-south-1a'] });
        expect(spreadOf([pod('p1', 'a'), pod('p2', 'b')], nodes)).toEqual({ nodes: ['a', 'b'], zones: ['ap-south-1a', 'ap-south-1b'] });
        // Kind's nodes have no zone.
        expect(spreadOf([pod('p1', 'w1')], [node('w1')]).zones).toEqual([]);
    });

    it('names each pod that isn\'t running, with what holds it up', () => {
        const status = (phase: string, containerStatuses: unknown[] = []) => ({ status: { phase, containerStatuses } });
        const ready = [{ ready: true, state: { running: {} } }];
        expect(unhealthyPods([
            pod('serving', 'a', status('Running', ready)),
            pod('done', 'a', status('Succeeded')),
            pod('leaving', 'a', { ...status('Running', [{ ready: false }]), metadata: { name: 'leaving', namespace: 'x', deletionTimestamp: 't' } }),
            // A Job's failure is the Job's to report.
            { metadata: { name: 'scan', namespace: 'splitx', ownerReferences: [{ kind: 'Job' }] }, status: { phase: 'Failed' } },
        ])).toEqual([]);
        expect(unhealthyPods([
            pod('pulling', 'a', status('Pending', [{ ready: false, state: { waiting: { reason: 'ImagePullBackOff' } } }])),
            pod('crashing', 'a', status('Running', [{ ready: false, state: { waiting: { reason: 'CrashLoopBackOff' } } }])),
            pod('warming', 'a', status('Running', [{ ready: false, state: { running: {} } }])),
            { metadata: { name: 'lost', namespace: 'x' }, status: { phase: 'Failed' } },
        ])).toEqual(['splitx/pulling: ImagePullBackOff', 'splitx/crashing: CrashLoopBackOff', 'splitx/warming: Running', 'x/lost: Failed']);
    });

    it('holds each app pod to the load balancer\'s readiness gate', () => {
        const gate = 'target-health.elbv2.k8s.aws/k8s-splitx-splitx-0123456789';
        const withGate = (name: string, value: string) => ({
            metadata: { name }, spec: { readinessGates: [{ conditionType: gate }] }, status: { conditions: [{ type: gate, status: value }] },
        });
        expect(ungatedPods([withGate('in', 'True')])).toEqual([]);
        expect(ungatedPods([withGate('registering', 'False'), { metadata: { name: 'no-gate' }, spec: {}, status: { conditions: [] } }]))
            .toEqual(['registering', 'no-gate']);
    });
});

describe('the EKS cluster behind a context', () => {
    it('is named by ARN in the kubeconfig; only its name and region are kept', () => {
        const kubeconfig = { contexts: [{ name: 'splitx', context: { cluster: 'arn:aws:eks:ap-south-1:' + ACCOUNT + ':cluster/splitx' } }, { name: 'kind-splitx', context: { cluster: 'kind-splitx' } }] };
        expect(eksClusterOf(kubeconfig, 'splitx')).toEqual({ region: 'ap-south-1', name: 'splitx' });
        expect(eksClusterOf(kubeconfig, 'kind-splitx')).toBeNull();
        expect(eksClusterOf({}, 'splitx')).toBeNull();
    });
});

describe('Pod Identity', () => {
    const podOf = (namespace: string, serviceAccountName: string, credentials = true) => ({
        metadata: { name: serviceAccountName + '-0', namespace },
        spec: { serviceAccountName, containers: [{ name: 'main', env: credentials ? [{ name: 'AWS_CONTAINER_CREDENTIALS_FULL_URI', value: 'http://169.254.170.23/v1/credentials' }] : [] }] },
        status: { phase: 'Running' },
    });
    const associations = POD_IDENTITY_ACCOUNTS.map((account: string) => {
        const [namespace, serviceAccount] = account.split('/');
        return { namespace, serviceAccount, role: 'splitx-wl-' + serviceAccount };
    });
    const pods = POD_IDENTITY_ACCOUNTS.map((account: string) => podOf(account.split('/')[0], account.split('/')[1]));
    const proofs = Object.fromEntries(POD_IDENTITY_ACCOUNTS.map((account: string) => [account, { works: true, detail: 'did its job' }]));

    it('names exactly the accounts terraform/platform gives a role', () => {
        const workloads = read('terraform/platform/workloads.tf');
        const bound = [...workloads.matchAll(/namespace\s*=\s*"([^"]+)"\s*\n\s*service_account\s*=\s*"([^"]+)"/g)].map((m) => m[1] + '/' + m[2]);
        // The EBS CSI add-on's association is made with the add-on, in kube-system.
        const addOn = [...read('terraform/platform/cluster.tf').matchAll(/service_account\s*=\s*"([^"]+)"/g)].map((m) => 'kube-system/' + m[1]);
        expect([...bound, ...addOn].sort()).toEqual([...POD_IDENTITY_ACCOUNTS].sort());
    });

    it('passes an account whose pods got credentials that did its job', () => {
        const findings = podIdentityFindings(associations, pods, proofs);
        expect(findings).toHaveLength(POD_IDENTITY_ACCOUNTS.length);
        expect(findings.every((finding: { ok: boolean }) => finding.ok)).toBe(true);
    });

    it('fails one with no association, no pod, no credentials, or no proof', () => {
        const [, ...rest] = associations;
        const findings = podIdentityFindings(rest, [podOf('kube-system', 'ebs-csi-controller-sa', false), ...pods.slice(2)],
            { ...proofs, 'ops/ops-api': { works: false, detail: 'stacks: AccessDenied' } });
        const problems = Object.fromEntries(findings.map((finding: { account: string }) => [finding.account, identityProblem(finding)]));
        expect(problems).toEqual({
            'kube-system/aws-load-balancer-controller': 'EKS has no Pod Identity association for it',
            'kube-system/ebs-csi-controller-sa': 'its pods got no credentials',
            'kube-system/cluster-autoscaler': null,
            'external-secrets/external-secrets': null,
            'ops/ops-api': 'stacks: AccessDenied',
        });
        expect(identityProblem(podIdentityFindings(associations, [], proofs)[0])).toBe('no pod running');
    });

    it('reads the autoscaler\'s status in both its forms', () => {
        const yaml = [
            'time: 2026-10-10 04:00:00 +0000 UTC',
            'autoscalerStatus: Running',
            'clusterWide:',
            '  health:',
            '    status: Healthy',
            '    nodeCounts:',
            '      registered:',
            '        total: 3',
            'nodeGroups:',
            '- name: eks-splitx-general-abcd',
            '  health:',
            '    status: Healthy',
        ].join('\n');
        expect(autoscalerHealth(yaml)).toEqual({ healthy: true, nodeGroups: 1 });
        const text = 'Cluster-autoscaler status at 2026-10-10:\nCluster-wide:\n  Health:      Healthy (ready=3 unready=0)\n\nNodeGroups:\n  Name:        eks-splitx-general-abcd\n  Health:      Healthy (ready=3)\n';
        expect(autoscalerHealth(text)).toEqual({ healthy: true, nodeGroups: 1 });
        expect(autoscalerHealth(yaml.replace('status: Healthy', 'status: Unhealthy').split('nodeGroups:')[0])).toEqual({ healthy: false, nodeGroups: 0 });
        expect(autoscalerHealth(undefined)).toEqual({ healthy: false, nodeGroups: 0 });
    });

    it('holds ops-api to the four readings it makes with its role', () => {
        const ok = { ok: true };
        expect(awsReadings({ stacks: ok, eks: ok, edge: ok, budget: ok }).every((reading: { ok: boolean }) => reading.ok)).toBe(true);
        expect(awsReadings({ stacks: ok, eks: { ok: false, error: 'no AWS role here' }, edge: ok, budget: ok })
            .filter((reading: { ok: boolean }) => !reading.ok)).toEqual([{ name: 'eks', ok: false, error: 'no AWS role here' }]);
        expect(awsReadings(null).map((reading: { error: string | null }) => reading.error)).toEqual(Array(4).fill('ops-api did not answer'));
    });
});

describe('EBS volumes', () => {
    const claim = (name: string, volumeName: string, phase = 'Bound') => ({
        metadata: { namespace: 'nexus', name }, spec: { volumeName, resources: { requests: { storage: '20Gi' } } }, status: { phase, capacity: { storage: '20Gi' } },
    });
    const volume = (name: string, handle: string, driver = 'ebs.csi.aws.com') => ({ metadata: { name }, spec: { csi: { driver, volumeHandle: handle } } });
    const ec2 = (id: string, extra = {}) => ({ VolumeId: id, VolumeType: 'gp3', Encrypted: true, State: 'in-use', AvailabilityZone: 'ap-south-1a', ...extra });

    it('passes a bound, encrypted gp3 volume the CSI driver made and attached', () => {
        expect(ebsFindings([claim('data-nexus-0', 'pv-1')], [volume('pv-1', 'vol-1')], [ec2('vol-1')])).toEqual([
            { claim: 'nexus/data-nexus-0', size: '20Gi', volume: 'vol-1', zone: 'ap-south-1a', problem: null, ok: true },
        ]);
    });

    it('names what is wrong with any other', () => {
        const problems = ebsFindings(
            [claim('a', 'pv-a', 'Pending'), claim('b', 'pv-b'), claim('c', 'pv-c'), claim('d', 'pv-d'), claim('e', 'pv-e'), claim('f', 'pv-f')],
            [volume('pv-b', 'x', 'rancher.io/local-path'), volume('pv-c', 'vol-c'), volume('pv-d', 'vol-d'), volume('pv-e', 'vol-e'), volume('pv-f', 'vol-f')],
            [ec2('vol-d', { Encrypted: false }), ec2('vol-e', { VolumeType: 'gp2' }), ec2('vol-f', { State: 'available' })],
        ).map((finding: { problem: string | null }) => finding.problem);
        expect(problems).toEqual(['not bound (Pending)', 'not an EBS volume', 'EC2 has no such volume', 'not encrypted', 'gp2, not gp3', 'available, not attached']);
    });
});

describe('the load balancer\'s rules', () => {
    const arn = (group: string) => 'arn:aws:elasticloadbalancing:ap-south-1:' + ACCOUNT + ':targetgroup/' + group + '/0123456789abcdef';
    const path = (...values: string[]) => [{ Field: 'path-pattern', Values: values, PathPatternConfig: { Values: values } }];
    const deny = { Type: 'fixed-response', FixedResponseConfig: { StatusCode: '403', ContentType: 'text/plain', MessageBody: 'Not available' } };
    const to = (group: string) => ({ Type: 'forward', TargetGroupArn: arn(group), ForwardConfig: { TargetGroups: [{ TargetGroupArn: arn(group), Weight: 1 }] } });
    // What the controller makes of the IngressGroup "splitx" (group.order 10, 20, 100).
    const rules = [
        { Priority: '1', Conditions: path('/api/metrics'), Actions: [deny], IsDefault: false },
        { Priority: '2', Conditions: path('/api/health/ready'), Actions: [deny], IsDefault: false },
        { Priority: '3', Conditions: path('/generic-webhook-trigger/*'), Actions: [to('k8s-jenkins-jenkins-5f8a0c1b2d')], IsDefault: false },
        { Priority: '4', Conditions: path('/*'), Actions: [to('k8s-splitx-splitx-9e7d6c5b4a')], IsDefault: false },
        { Priority: 'default', Conditions: [], Actions: [{ Type: 'fixed-response', FixedResponseConfig: { StatusCode: '404' } }], IsDefault: true },
    ];

    it('matches paths the way an ALB does', () => {
        expect(matchesPathPattern('/*', '/')).toBe(true);
        expect(matchesPathPattern('/api/metrics', '/api/metrics')).toBe(true);
        expect(matchesPathPattern('/api/metrics', '/API/metrics')).toBe(false);
        expect(matchesPathPattern('/generic-webhook-trigger/*', '/generic-webhook-trigger/invoke')).toBe(true);
        expect(matchesPathPattern('/generic-webhook-trigger/*', '/generic-webhook-trigger')).toBe(false);
        expect(matchesPathPattern('/a?c', '/abc')).toBe(true);
        expect(matchesPathPattern('/a.c', '/abc')).toBe(false);
    });

    it('decides each path by the first rule that matches it, and names groups without the account', () => {
        expect(albDecision(rules, '/api/metrics')).toEqual({ priority: '1', action: 'respond', status: 403 });
        expect(albDecision(rules, '/')).toEqual({ priority: '4', action: 'forward', targetGroup: 'k8s-splitx-splitx-9e7d6c5b4a' });
        expect(albDecision(rules.filter((rule) => !rule.IsDefault).slice(0, 2), '/')).toEqual({ priority: null, action: 'none' });
        expect(JSON.stringify(albFindings(rules))).not.toContain(ACCOUNT);
    });

    it('passes the listener the Ingresses describe', () => {
        expect(albFindings(rules).map((finding: { path: string; ok: boolean }) => [finding.path, finding.ok])).toEqual(ALB_EXPECTED.map((e: { path: string }) => [e.path, true]));
    });

    it('fails the one D-089 fixed, where the catch-all outranks the refusals', () => {
        const unordered = rules.map((rule) => ({ ...rule, Priority: { '1': '2', '2': '3', '3': '4', '4': '1' }[rule.Priority] ?? rule.Priority }));
        const failed = albFindings(unordered).filter((finding: { ok: boolean }) => !finding.ok).map((finding: { path: string }) => finding.path);
        expect(failed).toEqual(['/api/metrics', '/api/health/ready', '/generic-webhook-trigger/invoke']);
    });

    it('expects what the committed Ingresses say', () => {
        const internal = read('k8s/overlays/aws/patches/ingress-internal.yaml');
        for (const refused of ['/api/metrics', '/api/health/ready']) expect(internal).toContain('path: ' + refused);
        expect(internal).toContain('"statusCode":"403"');
        expect(read('jenkins/eks/ingress.yaml')).toMatch(/path: \/generic-webhook-trigger\/\n\s+pathType: Prefix\n[\s\S]*name: jenkins/);
    });
});

describe('the edge', () => {
    const template = read('terraform/edge/edge.js.tftpl').replace('${online}', 'true');
    const handler = new Function(`${template}\nreturn handler;`)() as (event: { request: { uri: string } }) => { statusCode?: number };

    it('refuses every spelling the verifier tries, as CloudFront runs the function', () => {
        expect(INTERNAL_SPELLINGS.length).toBeGreaterThanOrEqual(8);
        for (const spelling of INTERNAL_SPELLINGS) expect(handler({ request: { uri: spelling } }).statusCode, spelling).toBe(403);
        expect(handler({ request: { uri: '/api/health/live' } }).statusCode).toBeUndefined();
    });

    it('knows a response the function made from one the load balancer did', () => {
        expect(madeByEdgeFunction('FunctionGeneratedResponse from cloudfront')).toBe(true);
        expect(madeByEdgeFunction('Miss from cloudfront')).toBe(false);
        expect(madeByEdgeFunction('Error from cloudfront')).toBe(false);
        expect(madeByEdgeFunction(null)).toBe(false);
    });
});

describe('network policy, from another namespace', () => {
    const kindServices = new Set(['splitx/splitx', 'splitx/splitx-postgres', 'splitx/splitx-redis', 'ops/ops-api', 'ops/traffic-lab', 'jenkins/jenkins', 'nexus/nexus', 'kube-system/kube-dns']);

    it('tries the control first, then every guarded Service this cluster has', () => {
        const kind = policyTargets(kindServices);
        expect(kind[0]).toEqual(PROBE_CONTROL);
        expect(kind.map((t: { name: string }) => t.name)).toEqual(['control', 'app', 'postgres', 'redis', 'ops-api', 'traffic-lab', 'jenkins', 'nexus']);
        // EKS has no Postgres of its own; a cluster without an ops image has no ops-api.
        const eks = policyTargets(new Set([...kindServices].filter((s) => s !== 'splitx/splitx-postgres' && !s.startsWith('ops/'))));
        expect(eks.map((t: { name: string }) => t.name)).toEqual(['control', 'app', 'redis', 'jenkins', 'nexus']);
    });

    it('dials each Service on the port its manifest publishes', () => {
        const ports: Record<string, [string, number]> = {
            app: ['k8s/base/service.yaml', 80],
            redis: ['k8s/components/redis/service.yaml', 6379],
            'ops-api': ['k8s/ops/ops-api.yaml', 8080],
            'traffic-lab': ['k8s/ops/traffic-lab.yaml', 8080],
            nexus: ['nexus/statefulset.yaml', 8081],
        };
        for (const target of policyTargets(kindServices)) {
            if (!ports[target.name]) continue;
            expect(target.port, target.name).toBe(ports[target.name][1]);
            expect(read(ports[target.name][0]), target.name).toMatch(new RegExp('\\n\\s+port: ' + target.port + '\\n'));
        }
    });

    it('reports each target as reached, refused or unresolved, never guessing', () => {
        const targets = policyTargets(kindServices);
        const script = policyProbeScript(targets);
        expect(script.match(/nslookup /g)).toHaveLength(targets.length);
        expect(script.match(/nc -z -w 5 /g)).toHaveLength(targets.length);
        const results = readPolicyProbe('control=reached\napp=refused\npostgres=refused\nredis=unresolved\n', targets);
        expect(results.map((r: { verdict: string }) => r.verdict)).toEqual(['reached', 'refused', 'refused', 'unresolved', 'no answer', 'no answer', 'no answer', 'no answer']);
    });

    it('calls it enforced only when the control was reached and everything else refused', () => {
        const targets = policyTargets(new Set(['splitx/splitx', 'splitx/splitx-redis']));
        const verdicts = (...words: string[]) => readPolicyProbe(targets.map((t: { name: string }, i: number) => t.name + '=' + words[i]).join('\n'), targets);
        expect(policyEnforced(verdicts('reached', 'refused', 'refused'))).toBe(true);
        // A probe with no network refuses everything, the control too.
        expect(policyEnforced(verdicts('refused', 'refused', 'refused'))).toBe(false);
        expect(policyEnforced(verdicts('reached', 'reached', 'refused'))).toBe(false);
        expect(policyEnforced(verdicts('reached', 'unresolved', 'refused'))).toBe(false);
        expect(policyEnforced(readPolicyProbe('control=reached', [PROBE_CONTROL]))).toBe(false);
    });
});

describe('new connections from each app pod', () => {
    const pods = { items: [{ metadata: { name: 'splitx-1' }, spec: { nodeName: 'n1' }, status: { phase: 'Running' } }] };

    it('dials the database the pod is configured with on EKS, and the in-cluster one on Kind', () => {
        const scripts: string[] = [];
        const kubectl = (argv: string[]) => {
            if (argv[0] === 'get') return { code: 0, stdout: JSON.stringify(pods) };
            scripts.push(argv[argv.length - 1]);
            return { code: 0, stdout: 'dns=ok\npostgres=ok\nredis=ok\n' };
        };
        expect(checkNewConnections(kubectl)[0].ok).toBe(true);
        expect(checkNewConnections(kubectl, 'splitx', { database: 'from-url' })[0].ok).toBe(true);
        expect(scripts[0]).toContain('splitx-postgres.splitx.svc.cluster.local 5432');
        expect(scripts[1]).not.toContain('splitx-postgres');
        // Read inside the pod, by Node, and never printed.
        expect(scripts[1]).toContain('process.env.DATABASE_URL');
        expect(scripts[1]).toContain('splitx-redis.splitx.svc.cluster.local 6379');
    });

    it('takes only the host and port from the URL, and prints nothing of it', () => {
        const code = DATABASE_FROM_URL.match(/node -e '(.*)'$/)![1];
        const run = (url: string) => {
            let out = '';
            new Function('process', code)({ env: { DATABASE_URL: url }, stdout: { write: (text: string) => { out += text; } } });
            return out;
        };
        expect(run('postgresql://user:secret@ep-quiet-sky-123.ap-southeast-1.aws.neon.tech/splitx?sslmode=require')).toBe('ep-quiet-sky-123.ap-southeast-1.aws.neon.tech 5432');
        expect(run('postgresql://splitx:pw@splitx-postgres:6543/splitx')).toBe('splitx-postgres 6543');
    });
});

describe('the database, asked from inside a pod on EKS', () => {
    async function probe(email: string, rows = 1) {
        const calls: string[] = [];
        const table = (name: string, deleted: number) => ({
            count: vi.fn(async () => {
                calls.push(name + '.count');
                return calls.some((call) => call.startsWith(name + '.deleteMany')) ? 0 : rows;
            }),
            deleteMany: vi.fn(async ({ where }: { where: Record<string, string> }) => {
                calls.push(name + '.deleteMany ' + JSON.stringify(where));
                return { count: deleted };
            }),
        });
        class PrismaClient {
            user = table('user', rows);
            verificationToken = table('verificationToken', 0);
            $queryRawUnsafe = vi.fn(async () => [{ tables: 20 }]);
            $disconnect = vi.fn(async () => calls.push('disconnect'));
        }
        const printed: string[] = [];
        const fakeProcess = { argv: ['node', '-', email], exitCode: 0 };
        new Function('require', 'process', 'console', DATABASE_PROBE)(() => ({ PrismaClient }), fakeProcess, { log: (line: string) => printed.push(line) });
        await vi.waitFor(() => expect(calls).toContain('disconnect'));
        return { printed: printed.map((line) => JSON.parse(line)), calls, exitCode: fakeProcess.exitCode };
    }

    it('finds the check\'s account, removes it and its link, and prints only numbers', async () => {
        const email = 'k8s-verify+1760000000000@example.invalid';
        const { printed, calls, exitCode } = await probe(email);
        expect(printed).toEqual([{ tables: 20, stored: 1, removed: 1, links: 0, left: 0 }]);
        expect(calls).toContain('user.deleteMany ' + JSON.stringify({ email }));
        expect(calls).toContain('verificationToken.deleteMany ' + JSON.stringify({ identifier: email }));
        expect(exitCode).toBe(0);
    });

    it('touches nothing for any other address', async () => {
        const { printed, calls, exitCode } = await probe('someone@example.com');
        expect(printed).toEqual([{ error: 'not a check address' }]);
        expect(calls.filter((call) => call.includes('deleteMany'))).toEqual([]);
        expect(exitCode).toBe(1);
    });

    it('never prints Prisma\'s message, which can name the host', () => {
        expect(DATABASE_PROBE).not.toMatch(/error\.message/);
        expect(DATABASE_PROBE).toMatch(/error\.code \?\? error\.errorCode \?\? error\.name/);
    });
});

describe('GitHub\'s own delivery, in Jenkins\' record', () => {
    const build = (number: number, cause: string, result = 'SUCCESS') => ({ number, result, actions: [{}, { causes: [{ shortDescription: cause }] }] });

    it('is the build whose cause names the deployment and a delivery ID GitHub made', () => {
        const builds = [
            build(3, 'Started by user admin', 'FAILURE'),
            build(2, 'GitHub deployment 6645236192, delivery delivery-verify-1760000000000'),
            build(1, 'GitHub deployment 6645236192, delivery 5f0c7a2e-9b1d-11f0-8e2a-4c1d2b3a9f10'),
        ];
        expect(buildForDeployment(builds, 6645236192)?.number).toBe(1);
        expect(buildForDeployment(builds, 1)).toBeNull();
        expect(buildForDeployment([], 6645236192)).toBeNull();
    });

    it('matches the cause Jenkins\' job is configured to write', () => {
        expect(read('helm/platform/jenkins.values.yaml')).toContain("causeString('GitHub deployment $deployment_id, delivery $x_github_delivery')");
    });
});

describe('what cosign checked, in Jenkins\' record', () => {
    const REPOSITORY = 'Sayandip-Jana-1018/SplitX';

    it('keeps each check cosign printed under the signer, as in run 8\'s build', () => {
        const verification = cosignVerification(read('docs/evidence/kind-e2e/jenkins-build-1.txt'), REPOSITORY);
        expect(verification?.signed).toBe('signed by https://github.com/' + REPOSITORY + '/.github/workflows/ci.yml@refs/heads/main at commit e66a699d0229');
        expect(verification?.checks).toEqual([
            'The cosign claims were validated',
            'Existence of the claims in the transparency log was verified offline',
            'The code-signing certificate was verified using trusted certificate authority certificates',
        ]);
    });

    it('stops at the first line that is not one of them', () => {
        const log = '    signed by https://github.com/' + REPOSITORY + '/.github/workflows/ci.yml@refs/heads/main at commit abc; cosign checked:\n'
            + '      - The cosign claims were validated\n[Pipeline] }\n      - not cosign\'s\n';
        expect(cosignVerification(log, REPOSITORY)?.checks).toEqual(['The cosign claims were validated']);
    });

    it('is null for a log without a verified signature', () => {
        expect(cosignVerification('Started by user admin\nFinished: FAILURE\n', REPOSITORY)).toBeNull();
    });

    it('reads the line the verify step writes', () => {
        expect(read('jenkins/deploy.mjs')).toContain("' at commit ' + deployment.sha.slice(0, 12) + '; cosign checked:\\n    ' + checks.join('\\n    ')");
    });
});

describe('the AWS workflows run them', () => {
    const action = read('.github/actions/eks-verify/action.yml');

    it('in one action: both verifiers on EKS, the evidence kept, a failure failing the run', () => {
        expect(action).toContain('run: node scripts/cluster-verify.mjs --target eks');
        expect(action).toMatch(/args=\(--target eks\)\n\s+if \[\[ "\$ROLLBACK" == true \]\]; then args\+=\(--rollback\); fi\n\s+node scripts\/delivery-verify\.mjs "\$\{args\[@\]\}"/);
        expect(action).toContain('docs/evidence/kubernetes-eks.md');
        expect(action).toContain('docs/evidence/delivery-eks.md');
        expect(action.match(/continue-on-error: true/g)).toHaveLength(2);
        expect(action).toMatch(/if \[\[ "\$CLUSTER" != success \|\| "\$DELIVERY" != success \]\]; then/);
    });

    it('as aws-up\'s last step, after the delivery it checks', () => {
        const up = read('.github/workflows/aws-up.yml');
        expect(up.indexOf('uses: ./.github/actions/eks-verify')).toBeGreaterThan(up.indexOf('name: The release, deployed through Jenkins'));
        expect(up).toContain('rollback: ${{ inputs.rehearse_rollback }}');
    });

    it('and alone in aws-verify, approved, never beside aws-up or aws-down', () => {
        const verify = read('.github/workflows/aws-verify.yml');
        expect(verify).toContain('environment: aws-demo');
        expect(verify).toMatch(/concurrency:\n\s+group: aws\n\s+cancel-in-progress: false/);
        expect(verify).toContain('uses: ./.github/actions/eks-verify');
        expect(verify).toContain('--alias splitx');
        // It builds nothing: no terraform apply, no cluster-up.
        expect(verify).not.toMatch(/terraform[^\n]* apply|cluster-up\.mjs/);
        for (const workflow of ['aws-up.yml', 'aws-down.yml']) expect(read('.github/workflows/' + workflow)).toMatch(/concurrency:\n\s+group: aws\n/);
    });
});
