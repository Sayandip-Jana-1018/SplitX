#!/usr/bin/env node
/**
 * Proves the cluster does what the manifests claim, and writes what it measured
 * to docs/evidence/kubernetes.md (Kind) or docs/evidence/kubernetes-eks.md (EKS).
 *
 *   npm run k8s:verify                    the Kind cluster
 *   npm run k8s:verify -- --target eks    the EKS platform aws-up built (D-103)
 *
 * Every check runs against the live cluster: nothing here is a static
 * assertion about a YAML file. The interesting ones are the destructive pair —
 * a database outage (does readiness remove the pod without liveness killing
 * it?) and a rolling restart under continuous traffic (is a release lossless?)
 * — because those are the claims a deployment usually makes without evidence.
 *
 * On EKS the same checks go through CloudFront, where visitors arrive. The
 * ones only Kind has something to check (kindnet, the database outage,
 * ingress-nginx's log) are reported as skipped, with the reason, and EKS adds
 * what only it has: zones, the load balancer's readiness gates and rules, Pod
 * Identity, EBS volumes and the edge function (scripts/lib/platform-checks.mjs).
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    checkNewConnections, describe, describeKindnet, kindnetHealth, policyEnforced, policyProbeScript, policyTargets, readPolicyProbe,
} from './lib/cluster-network.mjs';
import { dashboardDatasourceUids, dashboardQueries, FIRST_EVENT_SERIES, metricNamesIn, withoutGrafanaVariables } from './lib/dashboards.mjs';
import {
    albFindings, autoscalerHealth, awsReadings, DATABASE_PROBE, ebsFindings, eksClusterOf, identityProblem, INTERNAL_SPELLINGS,
    madeByEdgeFunction, podIdentityFindings, spreadOf, ungatedPods, unhealthyPods,
} from './lib/platform-checks.mjs';
import { clusterSecret, KIND_ONLY, portForward, stopForwards, verifyTarget } from './lib/verify-target.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// The Grafana admin password, for the dashboard checks. Read, never printed.
if (existsSync(join(root, '.env'))) process.loadEnvFile(join(root, '.env'));
let target;
try {
    target = verifyTarget(process.argv.slice(2), (path) => readFileSync(join(root, path), 'utf8'));
} catch (error) {
    console.error('x ' + error.message);
    process.exit(1);
}
const EKS = target.name === 'eks';
const NS = 'splitx';
const CONTEXT = target.context;
// Where visitors arrive: ingress-nginx on Kind, CloudFront on EKS.
const BASE = target.base;
const PROBE_IMAGE = target.probeImage;

const checks = [];
const sections = [];
let failures = 0;

// `passed` null means skipped: the check does not apply to this cluster, and
// the detail says why. It is never counted as passed.
const VERDICT = new Map([[true, 'PASS'], [false, 'FAIL'], [null, 'SKIP']]);
function record(name, passed, detail) {
    checks.push({ name, passed, detail });
    if (passed === false) failures += 1;
    console.log('  ' + VERDICT.get(passed) + '  ' + name + (detail ? ' — ' + detail : ''));
}

function sh(file, argv, options = {}) {
    const result = spawnSync(file, argv, { cwd: root, encoding: 'utf8', shell: false, ...options });
    return {
        code: result.status,
        stdout: (result.stdout ?? '').trim(),
        stderr: (result.stderr ?? '').trim(),
    };
}

const kubectl = (argv, options) => sh('kubectl', ['--context', CONTEXT, ...argv], options);
const k = (argv, options) => kubectl(['-n', NS, ...argv], options);
const json = (argv) => JSON.parse(kubectl([...argv, '-o', 'json']).stdout || '{}');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function status(path, options = {}) {
    try {
        const response = await fetch(BASE + path, { redirect: 'manual', signal: AbortSignal.timeout(20_000), ...options });
        return response.status;
    } catch {
        return 0;
    }
}

async function waitFor(predicate, { timeoutMs = 120_000, everyMs = 2_000 } = {}) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const value = await predicate();
        if (value) return value;
        await sleep(everyMs);
    }
    return null;
}

// EKS only: the cluster behind the context, and the AWS CLI in its region, as
// whoever runs this (aws-up's deploy role, or the operator on the laptop).
// Nothing printed carries the account's number.
const withoutAccount = (text) => text.replace(/\d{12}/g, '<account>').replace(/\s+/g, ' ').slice(0, 200);
const cluster = EKS ? eksClusterOf(JSON.parse(sh('kubectl', ['config', 'view', '-o', 'json']).stdout || '{}'), CONTEXT) : null;
if (EKS && !cluster) {
    console.error('x the context ' + CONTEXT + ' is not an EKS cluster\'s: aws eks update-kubeconfig --name splitx --alias ' + CONTEXT);
    process.exit(1);
}
function aws(argv) {
    const result = sh('aws', [...argv, '--region', cluster.region, '--output', 'json']);
    if (result.code !== 0) return { value: null, error: withoutAccount(result.stderr || 'aws exited ' + result.code) };
    try {
        return { value: JSON.parse(result.stdout || 'null'), error: '' };
    } catch {
        return { value: null, error: 'an answer that is not JSON' };
    }
}

// What isn't published: on Kind, Prometheus, Alertmanager and Loki through the
// API server's service proxy, and Grafana on ingress-nginx. On EKS, all of it
// through `kubectl port-forward`: the nodes' security group admits the control
// plane on 443 and 10250 only, so the service proxy can't reach these ports.
const SERVICES = {
    prometheus: { namespace: 'monitoring', service: 'kube-prometheus-stack-prometheus', portName: 'http-web', port: 9090 },
    alertmanager: { namespace: 'monitoring', service: 'kube-prometheus-stack-alertmanager', portName: 'http-web', port: 9093 },
    loki: { namespace: 'monitoring', service: 'loki', portName: 'http-metrics', port: 3100 },
    grafana: { namespace: 'monitoring', service: 'kube-prometheus-stack-grafana', port: 80 },
    opsApi: { namespace: 'ops', service: 'ops-api', port: 8080 },
};
const forwarded = new Map();
function forward(name) {
    if (!forwarded.has(name)) {
        const { namespace, service, port } = SERVICES[name];
        const opening = portForward({ context: CONTEXT, namespace, service, port });
        // Awaited where it is used; a failure there reads as "no answer".
        opening.catch(() => {});
        forwarded.set(name, opening);
    }
    return forwarded.get(name);
}
async function inCluster(name, path) {
    const { namespace, service, portName } = SERVICES[name];
    try {
        if (!EKS) return JSON.parse(kubectl(['get', '--raw', '/api/v1/namespaces/' + namespace + '/services/' + service + ':' + portName + '/proxy' + path]).stdout);
        const response = await fetch((await forward(name)).url + path, { signal: AbortSignal.timeout(30_000) });
        return await response.json();
    } catch {
        return null;
    }
}
const promQuery = (expr) => inCluster('prometheus', '/api/v1/query?query=' + encodeURIComponent(expr));
const isReady = (pod) => pod.status?.conditions?.some((c) => c.type === 'Ready' && c.status === 'True');

console.log('SplitX — cluster verification (' + (EKS ? 'EKS, through ' + BASE : 'Kind') + ')\n');

// ── 1. Scheduling: where the pods actually run ────────────────────────────
console.log('[1] Scheduling');
const nodeItems = json(['get', 'nodes']).items ?? [];
const nodes = nodeItems.map((node) => ({
    name: node.metadata.name,
    roles: Object.keys(node.metadata.labels).filter((l) => l.startsWith('node-role')).map((l) => l.split('/')[1]).join(',') || 'worker',
    zone: node.metadata.labels['topology.kubernetes.io/zone'] ?? '-',
    version: node.status.nodeInfo.kubeletVersion,
}));
// Anything not running is named with what holds it up: an image that can't be
// pulled (Docker Hub limits a shared address), a crash loop, a missing Secret.
const everyPod = () => json(['get', 'pods', '--all-namespaces']).items ?? [];
const stuck = (await waitFor(() => (unhealthyPods(everyPod()).length === 0 ? [] : null), { timeoutMs: 60_000, everyMs: 5_000 })) ?? unhealthyPods(everyPod());
record(
    'Every pod in the cluster is running, or has finished its work',
    stuck.length === 0,
    stuck.length ? stuck.join('; ') : everyPod().length + ' pods, each running with every container ready, or completed'
);
// Pods with a deletionTimestamp are on their way out. Counting them would make
// a rollout look like it doubled the replica count for a few seconds.
const appPods = () => json(['get', 'pods', '-n', NS, '-l', 'app.kubernetes.io/name=splitx']).items
    .filter((pod) => !pod.metadata.deletionTimestamp);
const placement = appPods().map((pod) => ({
    pod: pod.metadata.name,
    node: pod.spec.nodeName,
    ip: pod.status.podIP,
    restarts: pod.status.containerStatuses?.[0]?.restartCount ?? 0,
    image: pod.spec.containers[0].image,
}));
const workersUsed = new Set(placement.map((p) => p.node));
if (EKS) {
    const spread = spreadOf(appPods(), nodeItems);
    record(
        'Replicas are spread across availability zones and nodes',
        spread.zones.length >= 2 && spread.nodes.length >= 2,
        placement.length + ' pods on ' + spread.nodes.length + ' nodes, in ' + (spread.zones.join(' and ') || 'no zone')
    );
    record('No application pod runs on the control plane', null, KIND_ONLY.controlPlane);
    // The controller's gate (k8s/overlays/aws/patches/namespace.yaml): a pod is
    // ready only once the load balancer has it registered and healthy.
    const readyPods = appPods().filter(isReady);
    const ungated = ungatedPods(readyPods);
    record(
        'Each app pod counts as ready only once the load balancer has it',
        readyPods.length > 0 && ungated.length === 0,
        ungated.length ? 'not vouched for by the load balancer: ' + ungated.join(', ') : readyPods.length + ' ready pods, each with the controller\'s target-health gate true'
    );
} else {
    record(
        'Replicas are spread across both worker nodes',
        workersUsed.size >= 2,
        placement.length + ' pods on ' + [...workersUsed].sort().join(', ')
    );
    record(
        'No application pod runs on the control plane',
        ![...workersUsed].some((node) => node.includes('control-plane')),
        'control plane carries ingress-nginx and the Kubernetes components only'
    );
}
sections.push({
    title: 'Where the pods run',
    body: [
        '| Node | Role | Zone | Kubelet |',
        '|---|---|---|---|',
        ...nodes.map((n) => '| `' + n.name + '` | ' + n.roles + ' | ' + n.zone + ' | ' + n.version + ' |'),
        '',
        '| Pod | Node | Pod IP | Restarts |',
        '|---|---|---|---|',
        ...placement.map((p) => '| `' + p.pod + '` | ' + p.node + ' | ' + p.ip + ' | ' + p.restarts + ' |'),
    ].join('\n'),
});

// ── 1b. New connections, which readiness cannot vouch for ─────────────────
console.log('[1b] New connections');
const network = checkNewConnections((argv) => kubectl(argv), NS, { database: EKS ? 'from-url' : 'in-cluster' });
record(
    EKS ? 'Every app pod can open new connections (DNS, the Neon database, Redis)' : 'Every app pod can open new connections (DNS, Postgres, Redis)',
    network.length > 0 && network.every((result) => result.ok),
    network.every((result) => result.ok)
        ? network.length + ' pods checked'
        : describe(network.filter((result) => !result.ok)).split(String.fromCharCode(10)).join('; ')
);

// ── 1c. The engine that judges those connections ──────────────────────────
// A connection check passes the moment kindnet catches up. Its own counters
// show whether it is about to fall behind again (D-050).
console.log('[1c] kindnet');
if (EKS) {
    record('kindnet keeps up: no CPU quota, no memory-limit hits, nothing left waiting for a verdict', null, KIND_ONLY.kindnet);
} else {
    const kindnet = kindnetHealth((node, script) => sh('docker', ['exec', node, 'sh', '-c', script]).stdout, nodes.map((n) => n.name));
    record(
        'kindnet keeps up: no CPU quota, no memory-limit hits, nothing left waiting for a verdict',
        kindnet.length === nodes.length && kindnet.every((result) => result.ok),
        kindnet.every((result) => result.ok)
            ? kindnet.reduce((sum, result) => sum + result.queued, 0) + ' new flows judged since kindnet started, '
                + kindnet.reduce((sum, result) => sum + result.dropped, 0) + ' dropped'
            : describeKindnet(kindnet.filter((result) => !result.ok)).split(String.fromCharCode(10)).join('; ')
    );
    sections.push({
        title: 'kindnet, the network-policy engine',
        body: [
            'The first packet of every new pod connection waits in netfilter queue 101 for kindnet to apply the',
            'network policies. Kind limits kindnet to 100m CPU and 50Mi by default, and at those',
            'limits new connections timed out in that queue (D-050). Counted since each kindnet container started.',
            '',
            '| Node | CPU quota | Throttled periods | Memory (peak) of limit | Limit hits | New flows judged | Waiting | Dropped |',
            '|---|---|---|---|---|---|---|---|',
            ...kindnet.map((r) => '| `' + r.node + '` | ' + r.cpuQuota + ' | ' + r.throttled + ' of ' + r.periods + ' | '
                + r.memoryMiB + ' MiB (' + r.peakMiB + ') of ' + (r.limitMiB === null ? 'no limit' : r.limitMiB + ' MiB') + ' | '
                + r.limitHits + ' | ' + r.queued + ' | ' + r.waiting + ' | ' + r.dropped + ' |'),
        ].join('\n'),
    });
}

// ── 1d, 1e. EKS: the volumes, and the workloads' AWS roles ────────────────
// The load balancer's address: the ALB checks below, and the controller's proof.
const albHost = EKS ? k(['get', 'ingress', 'splitx', '-o', 'jsonpath={.status.loadBalancer.ingress[0].hostname}']).stdout : '';
if (EKS) {
    console.log('[1d] Volumes');
    const claims = json(['get', 'pvc', '--all-namespaces']).items ?? [];
    const volumes = json(['get', 'pv']).items ?? [];
    const ids = volumes.map((volume) => volume.spec?.csi?.volumeHandle).filter(Boolean);
    const described = ids.length ? aws(['ec2', 'describe-volumes', '--volume-ids', ...ids]) : { value: { Volumes: [] }, error: '' };
    const ebs = ebsFindings(claims, volumes, described.value?.Volumes ?? []);
    const badVolumes = ebs.filter((finding) => !finding.ok);
    record(
        'Every volume is an encrypted gp3 EBS volume, made and attached by the CSI driver',
        ebs.length > 0 && badVolumes.length === 0,
        ebs.length === 0
            ? 'no volume claims at all' + (described.error ? '; EC2: ' + described.error : '')
            : (badVolumes.map((finding) => finding.claim + ': ' + finding.problem).join('; ')
                || ebs.length + ' claims: ' + ebs.map((finding) => finding.claim + ' ' + finding.size + ' in ' + finding.zone).join(', '))
    );
    sections.push({
        title: 'Volumes',
        body: [
            'Every PersistentVolumeClaim, and the EBS volume behind it as EC2 describes it. The default StorageClass',
            '(`k8s/eks/storageclass.yaml`) makes encrypted gp3 volumes in the zone of the node that first mounts them.',
            '',
            '| Claim | Size | Volume | Zone | Result |',
            '|---|---|---|---|---|',
            ...ebs.map((finding) => '| `' + finding.claim + '` | ' + finding.size + ' | ' + (finding.volume ?? '-') + ' | ' + (finding.zone ?? '-') + ' | '
                + (finding.ok ? 'gp3, encrypted, attached' : finding.problem) + ' |'),
        ].join('\n'),
    });

    console.log('[1e] Pod Identity');
    const listed = aws(['eks', 'list-pod-identity-associations', '--cluster-name', cluster.name]);
    // The role's name only: its ARN carries the account.
    const associations = (listed.value?.associations ?? []).map((association) => ({
        namespace: association.namespace,
        serviceAccount: association.serviceAccount,
        role: (aws(['eks', 'describe-pod-identity-association', '--cluster-name', cluster.name, '--association-id', association.associationId])
            .value?.association?.roleArn ?? '').split('/').pop() || '?',
    }));
    // What each account's credentials achieved, read from what it looks after.
    const bindings = (json(['get', 'targetgroupbindings.elbv2.k8s.aws', '--all-namespaces']).items ?? []).length;
    const externalSecrets = json(['get', 'externalsecrets.external-secrets.io', '--all-namespaces']).items ?? [];
    const synced = externalSecrets.filter(isReady);
    const autoscaler = autoscalerHealth(kubectl(['-n', 'kube-system', 'get', 'configmap', 'cluster-autoscaler-status', '-o', 'jsonpath={.data.status}']).stdout);
    const readings = await (async () => {
        try {
            const response = await fetch((await forward('opsApi')).url + '/v1/readings', { signal: AbortSignal.timeout(30_000) });
            return response.ok ? await response.json() : null;
        } catch {
            return null;
        }
    })();
    const fromAws = awsReadings(readings);
    const proofs = {
        'kube-system/aws-load-balancer-controller': {
            works: Boolean(albHost) && bindings >= 2,
            detail: albHost ? 'made the load balancer, with ' + bindings + ' target group bindings' : 'the Ingress has no load balancer',
        },
        'kube-system/ebs-csi-controller-sa': {
            works: ebs.length > 0 && badVolumes.length === 0,
            detail: (ebs.length - badVolumes.length) + ' of ' + ebs.length + ' volumes made and attached',
        },
        'kube-system/cluster-autoscaler': {
            works: autoscaler.healthy && autoscaler.nodeGroups > 0,
            detail: 'found ' + autoscaler.nodeGroups + ' node group(s) through AWS, ' + (autoscaler.healthy ? 'healthy' : 'NOT healthy'),
        },
        'external-secrets/external-secrets': {
            works: externalSecrets.length > 0 && synced.length === externalSecrets.length,
            detail: synced.length + ' of ' + externalSecrets.length + ' Secrets made from Secrets Manager',
        },
        'ops/ops-api': {
            works: fromAws.every((reading) => reading.ok),
            detail: fromAws.map((reading) => reading.name + (reading.ok ? ' read' : ': ' + reading.error)).join(', ')
                + (readings?.nodes?.ok ? '; and the API server, through 172.20.0.1' : ''),
        },
    };
    const identities = podIdentityFindings(associations, everyPod(), proofs);
    const failing = identities.filter((finding) => !finding.ok);
    record(
        'Every workload with an AWS role gets it from EKS Pod Identity, and uses it',
        identities.length > 0 && failing.length === 0,
        failing.length
            ? failing.map((finding) => finding.account + ': ' + identityProblem(finding)).join('; ') + (listed.error ? '; EKS: ' + listed.error : '')
            : identities.map((finding) => finding.account).join(', ')
    );
    sections.push({
        title: 'AWS roles, through EKS Pod Identity',
        body: [
            'No pod holds an AWS key. Each account below has a role (terraform/platform/workloads.tf) that trusts EKS',
            'Pod Identity and nothing else; EKS gives the account\'s pods short-lived credentials for it, and only them.',
            'Each is judged twice: its pods got the credentials, and they did the account\'s job.',
            '',
            '| Service account | Role | Pods | Credentials | What they did |',
            '|---|---|---|---|---|',
            ...identities.map((finding) => '| `' + finding.account + '` | ' + (finding.role ?? '-') + ' | ' + finding.pods + ' | '
                + (finding.injected ? 'given' : '**none**') + ' | ' + finding.detail + ' |'),
        ].join('\n'),
    });
}

// ── 2. The edge: what visitors can reach, and what is refused ─────────────
console.log('[2] The edge');
if (EKS) {
    const edge = { '/': await status('/'), '/login': await status('/login'), '/api/health/live': await status('/api/health/live') };
    record('The application is served at ' + BASE, edge['/'] === 200 && edge['/login'] === 200, '/ ' + edge['/'] + ' and /login ' + edge['/login'] + ', through CloudFront');
    record('Liveness stays reachable for a load balancer', edge['/api/health/live'] === 200, 'HTTP ' + edge['/api/health/live']);

    // The edge function (terraform/edge) refuses the internal paths before
    // CloudFront contacts the load balancer, whatever their spelling.
    const spellings = [];
    for (const path of INTERNAL_SPELLINGS) {
        const response = await fetch(BASE + path, { redirect: 'manual', signal: AbortSignal.timeout(20_000) }).catch(() => null);
        await response?.arrayBuffer().catch(() => null);
        spellings.push({ path, status: response?.status ?? 0, xCache: response?.headers.get('x-cache') ?? '' });
    }
    const passedOn = spellings.filter((spelling) => spelling.status !== 403 || !madeByEdgeFunction(spelling.xCache));
    record(
        'CloudFront refuses the internal paths itself, however they are spelled',
        passedOn.length === 0,
        passedOn.length
            ? passedOn.map((spelling) => spelling.path + ': HTTP ' + spelling.status + ', ' + (spelling.xCache || 'no X-Cache')).join('; ')
            : spellings.length + ' spellings, each answered 403 by the edge function ("' + spellings[0].xCache + '")'
    );

    // The load balancer's own rules: the second lock, and the only way in.
    const balancer = aws(['elbv2', 'describe-load-balancers']).value?.LoadBalancers?.find((lb) => lb.DNSName?.toLowerCase() === albHost.toLowerCase());
    const listener = balancer ? aws(['elbv2', 'describe-listeners', '--load-balancer-arn', balancer.LoadBalancerArn]).value?.Listeners?.find((l) => l.Port === 80) : null;
    const rules = listener ? aws(['elbv2', 'describe-rules', '--listener-arn', listener.ListenerArn]).value?.Rules ?? [] : [];
    const routes = albFindings(rules);
    record(
        'The load balancer refuses the internal paths itself, and routes the webhook to Jenkins and the rest to the app',
        rules.length > 0 && routes.every((route) => route.ok),
        rules.length ? routes.map((route) => route.path + ' ' + route.detail).join('; ') : 'could not read its rules' + (albHost ? '' : ': the Ingress has no load balancer')
    );
    const direct = albHost
        ? await fetch('http://' + albHost + '/api/health/live', { signal: AbortSignal.timeout(10_000) }).then((response) => response.status).catch(() => 0)
        : -1;
    record(
        'The load balancer answers nobody but CloudFront',
        direct === 0,
        direct === 0 ? 'a request from here had no answer in 10 s: its security group admits CloudFront\'s prefix list only' : 'HTTP ' + direct + ': it answered this machine'
    );
    // Someone else's CloudFront shares those addresses; ours alone adds the header (D-092).
    const unrouted = k(['exec', placement[0].pod, '--', 'sh', '-c', 'wget -qO- http://127.0.0.1:3000/ 2>&1 | head -1']);
    const unroutedSaid = (unrouted.stdout + ' ' + unrouted.stderr).trim();
    record(
        'The application refuses a request that did not come through SplitX\'s edge',
        unroutedSaid.includes('403'),
        unroutedSaid.includes('403') ? 'GET / inside a pod, without CloudFront\'s X-Origin-Verify: HTTP 403' : unroutedSaid.slice(0, 80)
    );
    sections.push({
        title: 'What the edge exposes',
        body: [
            '| Path | Status through CloudFront | Why |',
            '|---|---|---|',
            '| `/` | ' + edge['/'] + ' | the application |',
            '| `/login` | ' + edge['/login'] + ' | a real page, not just the root |',
            '| `/api/health/live` | ' + edge['/api/health/live'] + ' | a load balancer has to be able to ask |',
            ...spellings.map((spelling) => '| `' + spelling.path + '` | ' + spelling.status + ' (' + (spelling.xCache || 'no X-Cache') + ') | an internal path, refused at the edge |'),
            '',
            'Behind CloudFront, the load balancer\'s listener, rule by rule, as AWS describes it:',
            '',
            '| Path | What the load balancer does | Why |',
            '|---|---|---|',
            ...routes.map((route) => '| `' + route.path + '` | ' + route.detail + ' | ' + route.why + ' |'),
            '',
            'The load balancer itself admits only CloudFront\'s origin-facing addresses (a request from here got '
                + (direct === 0 ? 'no answer' : 'HTTP ' + direct) + '), and the application refuses anything without our edge\'s header.',
        ].join('\n'),
    });
} else {
    const edge = {
        '/': await status('/'),
        '/login': await status('/login'),
        '/api/health/live': await status('/api/health/live'),
        '/api/health/ready': await status('/api/health/ready'),
        '/api/metrics': await status('/api/metrics'),
    };
    record('The application is served on http://localhost/', edge['/'] === 200, 'HTTP ' + edge['/']);
    record(
        'Operational endpoints are refused at the edge',
        edge['/api/metrics'] === 403 && edge['/api/health/ready'] === 403,
        '/api/metrics ' + edge['/api/metrics'] + ', /api/health/ready ' + edge['/api/health/ready'] + ' (B-011)'
    );
    record('Liveness stays reachable for a load balancer', edge['/api/health/live'] === 200, 'HTTP ' + edge['/api/health/live']);
    sections.push({
        title: 'What the edge exposes',
        body: [
            '| Path | Status through ingress-nginx | Why |',
            '|---|---|---|',
            '| `/` | ' + edge['/'] + ' | the application |',
            '| `/login` | ' + edge['/login'] + ' | a real page, not just the root |',
            '| `/api/health/live` | ' + edge['/api/health/live'] + ' | a load balancer has to be able to ask |',
            '| `/api/health/ready` | ' + edge['/api/health/ready'] + ' | queries the database on every call — kubelet only |',
            '| `/api/metrics` | ' + edge['/api/metrics'] + ' | token-protected, and not published at all |',
        ].join('\n'),
    });
}

// ── 3. Provenance: which build is actually running ────────────────────────
console.log('[3] Provenance and metrics');
const firstPod = placement[0].pod;
const provenance = k(['exec', firstPod, '--', 'printenv', 'GIT_SHA', 'APP_VERSION']).stdout.split(/\r?\n/);
record(
    'The running pod reports the commit it was built from',
    Boolean(provenance[0]) && provenance[0] !== 'unknown',
    'git_sha ' + provenance[0] + ', version ' + (provenance[1] ?? '?')
);
// The token never leaves the container: the shell inside the pod expands it.
const inPodMetrics = k(['exec', firstPod, '--', 'sh', '-c',
    'wget -qO- --header="Authorization: Bearer $METRICS_TOKEN" http://127.0.0.1:3000/api/metrics | grep -E "^splitx_(app_info|rate_limiter_info)" | head -4']).stdout;
record(
    'Metrics are readable inside the cluster, with the token',
    inPodMetrics.includes('splitx_app_info'),
    inPodMetrics.split('\n').length + ' info series'
);
record(
    'The rate limiter is using the in-cluster Redis',
    inPodMetrics.includes('backend="redis"'),
    inPodMetrics.includes('backend="redis"') ? 'splitx_rate_limiter_info{backend="redis"}' : 'NOT redis'
);
const unauthorised = k(['exec', firstPod, '--', 'sh', '-c',
    'wget -qO- http://127.0.0.1:3000/api/metrics 2>&1 | head -1']);
record(
    'Metrics without the token are refused even from inside the pod',
    (unauthorised.stdout + unauthorised.stderr).includes('401'),
    (unauthorised.stdout + unauthorised.stderr).slice(0, 60)
);

// ── 3b. End to end: the application against its own database ──────────────
console.log('[3b] End to end, the way visitors arrive');
const stamp = Date.now();
const testEmail = 'k8s-verify+' + stamp + '@example.invalid';
const registered = await fetch(BASE + '/api/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Cluster Check', email: testEmail, password: 'rehearsal-' + stamp }),
    signal: AbortSignal.timeout(30_000),
}).catch(() => ({ status: 0 }));
let tables;
if (EKS) {
    // Neon's demo branch: asked, and cleaned, from inside a pod, with the app's
    // own client and address (DATABASE_PROBE). Only numbers come back.
    const asked = k(['exec', '-i', firstPod, '--', 'node', '-', testEmail], { input: DATABASE_PROBE });
    let database = {};
    try {
        database = JSON.parse(asked.stdout.split('\n').pop() || '{}');
    } catch {
        database = { error: 'no answer' };
    }
    tables = database.tables;
    record(
        'The demo database has the schema',
        Number(database.tables) >= 18,
        database.error ? 'could not ask it: ' + database.error : database.tables + ' tables in the public schema of Neon\'s demo branch'
    );
    record(
        'A write through the edge reaches the database',
        registered.status === 201 && database.stored === 1 && database.left === 0,
        'POST /api/register -> ' + registered.status + ' through CloudFront; '
            + (database.error ? 'the database could not be read: ' + database.error : database.stored + ' row found in the User table, then removed')
    );
} else {
    const psql = (sql) => k(['exec', 'statefulset/splitx-postgres', '--', 'psql', '-U', 'splitx', '-d', 'splitx', '-tAc', sql]).stdout.trim();
    tables = psql("SELECT count(*) FROM information_schema.tables WHERE table_schema='public'");
    const stored = psql("SELECT count(*) FROM \"User\" WHERE email = '" + testEmail + "'");
    psql("DELETE FROM \"User\" WHERE email = '" + testEmail + "'");
    record(
        'The schema Job built a real database',
        Number(tables) >= 18,
        tables + ' tables in the public schema'
    );
    record(
        'A write through the ingress reaches Postgres',
        registered.status === 201 && stored === '1',
        'POST /api/register -> ' + registered.status + ', row found in the User table, then removed'
    );
}

// The load target for phase 4: pure CPU, no database, behind the same edge.
const previewStarted = Date.now();
const preview = await fetch(BASE + '/api/settlements/preview', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scenario: { members: 400, seed: 7 } }),
    signal: AbortSignal.timeout(30_000),
}).catch(() => ({ status: 0 }));
const previewBody = preview.status === 200 ? await preview.json() : null;
record(
    'The settlement preview runs on the cluster',
    preview.status === 200,
    previewBody
        ? '400 members planned in ' + previewBody.data.computeMs + ' ms by ' + previewBody.data.servedBy + ' (' + (Date.now() - previewStarted) + ' ms round trip)'
        : 'HTTP ' + preview.status
);
const via = EKS ? 'through CloudFront' : 'through ingress-nginx';
sections.push({
    title: 'The application, not just the pods',
    body: [
        '| Check | Result |',
        '|---|---|',
        '| Tables in the database\'s public schema | ' + tables + (EKS ? ' (Neon\'s demo branch)' : ' (made by the schema Job)') + ' |',
        '| `POST /api/register` ' + via + ' | HTTP ' + registered.status + ', row written to the database and removed again |',
        '| `POST /api/settlements/preview` (400 members) ' + via + ' | HTTP ' + preview.status + (previewBody ? ', planned in ' + previewBody.data.computeMs + ' ms' : '') + ' |',
        '',
        'The preview is the endpoint the traffic lab uses to drive the autoscaler: it is pure CPU with',
        'no database behind it, so a pod under load is doing arithmetic, not waiting on the database.',
    ].join('\n'),
});

// ── 4. Pod Security admission ─────────────────────────────────────────────
console.log('[4] Admission control');
const privileged = kubectl(['run', 'pss-probe', '-n', NS, '--image', PROBE_IMAGE,
    '--restart=Never', '--privileged', '--dry-run=server', '--command', '--', 'true']);
record(
    'The namespace refuses a privileged pod',
    privileged.code !== 0 && /violates PodSecurity/i.test(privileged.stderr),
    privileged.code !== 0 ? 'rejected by PodSecurity admission' : 'ACCEPTED — the namespace is not enforcing'
);

// ── 5. Network policy ─────────────────────────────────────────────────────
console.log('[5] Network policy (this one takes about a minute)');
const services = new Set((json(['get', 'services', '--all-namespaces']).items ?? []).map((service) => service.metadata.namespace + '/' + service.metadata.name));
const probeTargets = policyTargets(services);
kubectl(['delete', 'pod', 'netpol-probe', '-n', 'default', '--ignore-not-found'], {});
kubectl(['run', 'netpol-probe', '-n', 'default', '--image', PROBE_IMAGE, '--restart=Never', '--command', '--',
    'sh', '-c', policyProbeScript(probeTargets)]);
await waitFor(() => {
    const phase = kubectl(['get', 'pod', 'netpol-probe', '-n', 'default', '-o', 'jsonpath={.status.phase}']).stdout;
    return phase === 'Succeeded' || phase === 'Failed' ? phase : null;
}, { timeoutMs: 180_000 });
const probeLog = kubectl(['logs', 'netpol-probe', '-n', 'default']).stdout;
kubectl(['delete', 'pod', 'netpol-probe', '-n', 'default', '--ignore-not-found', '--wait=false'], {});
const probed = readPolicyProbe(probeLog, probeTargets);
const enforced = policyEnforced(probed);
const engine = EKS ? 'the VPC CNI\'s policy agent' : 'kindnet';
record(
    'A pod in another namespace reaches none of the platform\'s services',
    enforced,
    probed.map((result) => result.name + ' ' + result.verdict).join(', ') + ' (enforced by ' + engine + ')'
);
sections.push({
    title: 'Network policy, tested from outside the namespaces',
    body: [
        'A `busybox` pod in the `default` namespace resolved each Service, then tried to connect to it. The first,',
        'CoreDNS over TCP, has no policy in front of it: reaching it shows the probe has a network, so every',
        'refusal after it is a policy\'s, applied here by ' + engine + '.',
        '',
        '| Target | Address | Result |',
        '|---|---|---|',
        ...probed.map((result) => '| ' + result.name + ' | `' + result.host + ':' + result.port + '` | ' + result.verdict + ' |'),
        '',
        'The positive control for the policies themselves is the application: its readiness probe passes, which',
        'means it reaches its database, and its pages load through the edge, which the policy does allow.',
    ].join('\n'),
});

// ── 6. Autoscaler input ───────────────────────────────────────────────────
console.log('[6] HorizontalPodAutoscaler');
const utilisation = await waitFor(() => {
    const hpa = json(['get', 'hpa', 'splitx', '-n', NS]);
    const current = hpa.status?.currentMetrics?.[0]?.resource?.current?.averageUtilization;
    return current === undefined || current === null ? null : { current, status: hpa.status };
}, { timeoutMs: 120_000 });
record(
    'The autoscaler is reading real CPU from metrics-server',
    utilisation !== null,
    utilisation ? utilisation.current + '% of the 250m request, target 60%' : 'still <unknown> after 2 minutes'
);
const pdb = json(['get', 'pdb', 'splitx', '-n', NS]).status ?? {};
record(
    'A disruption budget protects the deployment',
    (pdb.disruptionsAllowed ?? 0) >= 1 && (pdb.currentHealthy ?? 0) >= 2,
    pdb.currentHealthy + ' healthy, ' + pdb.disruptionsAllowed + ' disruption allowed at a time'
);

// ── 7. A database outage ──────────────────────────────────────────────────
console.log('[7] Database outage (~90 s)');
if (EKS) {
    record('A database outage empties the Service without restarting a pod', null, KIND_ONLY.databaseOutage);
} else {
    const restartsBefore = appPods().map((p) => p.status.containerStatuses[0].restartCount).reduce((a, b) => a + b, 0);
    k(['scale', 'statefulset/splitx-postgres', '--replicas=0']);
    const wentNotReady = await waitFor(() => {
        const ready = appPods().filter(isReady);
        return ready.length === 0 ? true : null;
    }, { timeoutMs: 120_000 });
    const duringOutage = { edge: await status('/'), live: await status('/api/health/live') };
    const endpoints = json(['get', 'endpointslices', '-n', NS, '-l', 'kubernetes.io/service-name=splitx']).items
        .flatMap((slice) => slice.endpoints ?? [])
        .filter((endpoint) => endpoint.conditions?.ready).length;
    const restartsDuring = appPods().map((p) => p.status.containerStatuses[0].restartCount).reduce((a, b) => a + b, 0);
    record(
        'Readiness fails when the database is gone',
        wentNotReady === true,
        'every replica left the Service; ' + endpoints + ' ready endpoints remain'
    );
    record(
        'Liveness does NOT restart the pods during a database outage',
        restartsDuring === restartsBefore,
        'restart count stayed at ' + restartsDuring + ' (B-005)'
    );
    k(['scale', 'statefulset/splitx-postgres', '--replicas=1']);
    k(['rollout', 'status', 'statefulset/splitx-postgres', '--timeout=180s']);
    // Every replica, not just the first one to answer: Prisma reconnects lazily,
    // so a pod can still be failing readiness while its neighbour is already
    // serving. Starting the next test from a half-recovered deployment would
    // measure the recovery, not the release.
    const recovered = await waitFor(async () => {
        const deployment = json(['get', 'deployment', 'splitx', '-n', NS]);
        const allReady = deployment.status?.readyReplicas === deployment.spec.replicas;
        return allReady && (await status('/api/health/live')) === 200 && (await status('/')) === 200 ? true : null;
    }, { timeoutMs: 180_000 });
    const restartsAfter = appPods().map((p) => p.status.containerStatuses[0].restartCount).reduce((a, b) => a + b, 0);
    record(
        'The same pods serve again once the database is back',
        recovered === true && restartsAfter === restartsBefore,
        'no pod was replaced; restart count ' + restartsAfter
    );
    sections.push({
        title: 'What a database outage does',
        body: [
            'The Postgres StatefulSet was scaled to zero with the application running, then back to one.',
            '',
            '| | Before | During the outage | After |',
            '|---|---|---|---|',
            '| Ready replicas | 2 | 0 | 2 |',
            '| Ready endpoints behind the Service | 2 | ' + endpoints + ' | 2 |',
            '| Container restarts (total) | ' + restartsBefore + ' | ' + restartsDuring + ' | ' + restartsAfter + ' |',
            '| `GET /` through the ingress | 200 | ' + duringOutage.edge + ' | 200 |',
            '| `GET /api/health/live` | 200 | ' + duringOutage.live + ' | 200 |',
            '',
            'This is the split the probes were written for. Readiness takes a pod out of the Service the',
            'moment it cannot serve, so the ingress answers ' + duringOutage.edge + ' instead of a broken page; liveness ignores the',
            'database entirely, so a database problem never turns into a restart loop across every replica.',
        ].join('\n'),
    });
}

// ── 8. A release under traffic ────────────────────────────────────────────
console.log('[8] Rolling restart under continuous traffic');
const before = new Set(appPods().map((p) => p.metadata.name));
const traffic = { total: 0, ok: 0, notOk: 0, failed: 0, pods: new Map(), codes: new Map() };
let hammering = true;

async function hammer() {
    while (hammering) {
        try {
            const response = await fetch(BASE + '/api/health/live', { signal: AbortSignal.timeout(10_000) });
            traffic.total += 1;
            if (response.status === 200) {
                traffic.ok += 1;
                const body = await response.json();
                traffic.pods.set(body.pod, (traffic.pods.get(body.pod) ?? 0) + 1);
            } else {
                traffic.notOk += 1;
                // Which code it is matters: 503 means the Service had no ready
                // endpoint, 502 means the proxy reached a pod that had already gone.
                traffic.codes.set(response.status, (traffic.codes.get(response.status) ?? 0) + 1);
                await response.text();
            }
        } catch {
            traffic.total += 1;
            traffic.failed += 1;
        }
    }
}

const started = Date.now();
const workers = [hammer(), hammer(), hammer(), hammer()];
// spawn, not spawnSync: a synchronous child would freeze the request loops and
// the "no requests were lost" result would be an artefact of the measurement.
// On EKS each new pod must also become a healthy load balancer target first.
const restart = await spawnAsync('kubectl', ['--context', CONTEXT, '-n', NS, 'rollout', 'restart', 'deployment/splitx']);
const rollout = await spawnAsync('kubectl', ['--context', CONTEXT, '-n', NS, 'rollout', 'status', 'deployment/splitx', '--timeout=' + (EKS ? '600s' : '300s')]);
hammering = false;
await Promise.all(workers);
const rolloutSeconds = ((Date.now() - started) / 1000).toFixed(1);
const after = new Set(appPods().map((p) => p.metadata.name));
const replaced = [...before].every((name) => !after.has(name));

record('The rollout completed', restart.code === 0 && rollout.code === 0, rollout.stdout.split('\n').pop());
record('Every pod was replaced', replaced && after.size === before.size, before.size + ' old pods gone, ' + after.size + ' new pods serving');
record(
    'No request was lost while every pod was replaced',
    traffic.notOk === 0 && traffic.failed === 0,
    traffic.total + ' requests in ' + rolloutSeconds + ' s: ' + traffic.ok + ' OK, ' + traffic.notOk + ' non-200, ' + traffic.failed + ' failed'
        + (traffic.codes.size ? ' [' + [...traffic.codes.entries()].map(([code, n]) => code + ' x' + n).join(', ') + ']' : '')
);
const servedBy = [...traffic.pods.entries()].sort((a, b) => b[1] - a[1]);
// For a few seconds after Kubernetes calls the rollout complete, the proxy in
// front still holds connections to the pods that are draining — which is
// exactly what the preStop delay keeps alive, and those requests are answered
// normally. What has to be true is that traffic moves off them promptly.
let lastPod = null;
const drainStarted = Date.now();
const settled = await waitFor(async () => {
    try {
        const body = await (await fetch(BASE + '/api/health/live', { signal: AbortSignal.timeout(10_000) })).json();
        lastPod = body.pod;
        return after.has(body.pod) ? body.pod : null;
    } catch {
        return null;
    }
}, { timeoutMs: 45_000, everyMs: 500 });
const drainMs = Date.now() - drainStarted;
record(
    'Traffic settles on the new pods',
    settled !== null,
    settled
        ? 'within ' + drainMs + ' ms of the rollout completing; ' + servedBy.length + ' pod(s) answered during it'
        : 'still answered by ' + lastPod + ' after 45 s'
);
sections.push({
    title: 'A release with no dropped requests',
    body: [
        '`kubectl rollout restart` with four concurrent clients hitting ' + (EKS ? 'CloudFront' : 'the ingress') + ' throughout.',
        'The deployment uses `maxSurge: 1, maxUnavailable: 0`, so a new pod must pass its readiness',
        EKS
            ? 'probe, and be a healthy target of the load balancer, before an old one is taken out. A `preStop` sleep of 20 s'
            : 'probe before an old one is taken out, and a `preStop` sleep of 5 s gives ingress-nginx time',
        EKS
            ? 'keeps a leaving pod serving while the load balancer stops sending to it.'
            : 'to stop routing to a pod before its server begins shutting down.',
        '',
        '| | |',
        '|---|---|',
        '| Requests during the release | ' + traffic.total + ' in ' + rolloutSeconds + ' s |',
        '| HTTP 200 | ' + traffic.ok + ' |',
        '| Non-200 responses | ' + traffic.notOk + (traffic.codes.size ? ' (' + [...traffic.codes.entries()].map(([code, n]) => n + ' x HTTP ' + code).join(', ') + ')' : '') + ' |',
        '| Connection failures | ' + traffic.failed + ' |',
        '| Pods that answered | ' + servedBy.length + ' |',
        '| Traffic fully on the new pods | ' + (settled ? drainMs + ' ms after the rollout reported complete' : 'not within 45 s') + ' |',
        '',
        'Requests answered per pod (the name comes from the pod itself, through the downward API).',
        'Connections are reused, so a short rollout can be served mostly by one pod; what',
        'matters is that the pods serving afterwards are the new ones:',
        '',
        '```',
        ...servedBy.map(([pod, count]) => pod + '  ' + count),
        '```',
    ].join('\n'),
});

// ── 9. Monitoring: Prometheus, Alertmanager and Grafana ───────────────────
console.log('[9] Monitoring');
const readTargets = async () => (await inCluster('prometheus', '/api/v1/targets?state=active'))?.data?.activeTargets ?? [];
const readyPods = appPods().filter(isReady).map((pod) => pod.metadata.name);
// Matched by name, not counted: a pod the release test is still shutting down
// stays a target for a few seconds, and would stand in for a new pod that
// has not been scraped yet.
const scrapedPods = (now) => new Set(now
    .filter((t) => t.labels.job === 'splitx' && t.labels.namespace === NS && t.health === 'up')
    .map((t) => t.labels.pod));
// The release test above replaced every pod. Prometheus discovers new pods at
// once but first scrapes them within an interval (15 s); until then their
// health is "unknown", not down. Allow a few intervals before judging.
const targets = (await waitFor(async () => {
    const now = await readTargets();
    const scrapedNow = scrapedPods(now);
    return readyPods.every((pod) => scrapedNow.has(pod)) && now.length > 0 && now.every((t) => t.health === 'up') ? now : null;
}, { timeoutMs: 90_000, everyMs: 5_000 })) ?? (await readTargets());
const scraped = scrapedPods(targets);
record(
    'Prometheus scrapes every ready application pod, with the metrics token',
    readyPods.length > 0 && readyPods.every((pod) => scraped.has(pod)),
    readyPods.filter((pod) => scraped.has(pod)).length + ' of ' + readyPods.length + ' ready pods scraped'
);
const downTargets = targets.filter((t) => t.health !== 'up');
const jobs = [...new Set(targets.map((t) => t.labels.job))].sort();
record(
    'Every scrape target is up',
    targets.length > 0 && downTargets.length === 0,
    downTargets.length
        ? downTargets.map((t) => t.labels.job + ' ' + t.scrapeUrl + ': ' + (t.lastError || t.health)).join('; ')
        : targets.length + ' targets in ' + jobs.length + ' jobs'
);

const ruleGroups = (await inCluster('prometheus', '/api/v1/rules'))?.data?.groups ?? [];
const committedAlerts = (readFileSync(join(root, 'k8s/base/prometheusrule.yaml'), 'utf8').match(/^\s+- alert: /gm) || []).length;
const splitxRules = ruleGroups.filter((group) => group.name.startsWith('splitx.')).flatMap((group) => group.rules);
const brokenRules = ruleGroups.flatMap((group) => group.rules).filter((rule) => rule.health !== 'ok');
record(
    'The SplitX alert rules are loaded, and every rule evaluates cleanly',
    splitxRules.length === committedAlerts && brokenRules.length === 0,
    splitxRules.length + ' of ' + committedAlerts + ' SplitX rules loaded; '
        + ruleGroups.flatMap((group) => group.rules).length + ' rules in total, '
        + (brokenRules.length ? brokenRules.map((rule) => rule.name + ': ' + rule.lastError).join('; ') : '0 with errors')
);

const alertmanagerAlerts = (await inCluster('alertmanager', '/api/v2/alerts')) ?? [];
record(
    'Alertmanager receives what Prometheus fires',
    alertmanagerAlerts.some((alert) => alert.labels.alertname === 'Watchdog'),
    'Watchdog, which fires all the time by design, is in Alertmanager'
);
const firing = alertmanagerAlerts.filter((alert) => alert.status?.state === 'active' && alert.labels.alertname !== 'Watchdog' && alert.labels.alertname !== 'InfoInhibitor');
record(
    'No alert is firing apart from Watchdog',
    firing.length === 0,
    firing.length ? firing.map((alert) => alert.labels.alertname + (alert.labels.pod ? ' (' + alert.labels.pod + ')' : '')).join(', ') : 'nothing needs attention'
);
const alertmanagerConfig = (await inCluster('alertmanager', '/api/v2/status'))?.config?.original ?? '';
const emailSent = Number((await promQuery('sum(alertmanager_notifications_total{integration="email"})'))?.data?.result?.[0]?.value?.[1] ?? 0);
const emailFailed = Number((await promQuery('sum(alertmanager_notifications_failed_total{integration="email"})'))?.data?.result?.[0]?.value?.[1] ?? 0);
// The counts live in Alertmanager's memory and start again from 0 when it restarts.
const alertmanagerStarted = json(['get', 'pods', '-n', 'monitoring', '-l', 'app.kubernetes.io/name=alertmanager']).items?.[0]
    ?.status.containerStatuses?.find((c) => c.name === 'alertmanager')?.state?.running?.startedAt;
const emailConfigured = alertmanagerConfig.includes('email_configs');
// A laptop's .env names a receiver. A kind-e2e run has one only if the
// repository gives it the ALERT_* secrets (D-099); without them there is no
// email to check, and the check says so instead of failing or passing. On EKS
// the receiver is whatever .env held when npm run aws:secrets copied it.
const receiverChosen = Boolean(process.env.ALERT_SMTP_USERNAME && process.env.ALERT_SMTP_PASSWORD && process.env.ALERT_EMAIL_TO);
let emailVerdict = emailConfigured && emailFailed === 0;
if (EKS ? !emailConfigured : !receiverChosen && process.env.GITHUB_ACTIONS === 'true') emailVerdict = null;
let emailDetail;
if (emailConfigured) {
    emailDetail = emailSent + ' notification(s) sent through Gmail and ' + emailFailed + ' failed since Alertmanager '
        + (alertmanagerStarted ? 'started at ' + alertmanagerStarted.replace('T', ' ').replace(/:\d\dZ$/, ' UTC') : 'last started');
} else if (EKS) {
    emailDetail = 'the platform has no email receiver: .env had no ALERT_SMTP_USERNAME, ALERT_SMTP_PASSWORD and ALERT_EMAIL_TO when npm run aws:secrets copied it';
} else if (process.env.GITHUB_ACTIONS === 'true') {
    emailDetail = 'this run has no email receiver: the repository has no ALERT_SMTP_USERNAME, ALERT_SMTP_PASSWORD and ALERT_EMAIL_TO secrets';
} else {
    emailDetail = 'no email receiver: .env has no ALERT_SMTP_USERNAME, ALERT_SMTP_PASSWORD and ALERT_EMAIL_TO';
}
record('Alerts are routed to email, and every email was accepted', emailVerdict, emailDetail);

// Grafana: its Ingress answers for grafana.localhost on Kind's port 80; on EKS
// it isn't published, and is reached through a port-forward.
const grafanaPassword = EKS ? clusterSecret(CONTEXT, 'monitoring', 'grafana-admin', 'admin-password') : (process.env.GF_ADMIN_PASSWORD ?? '');
async function grafana(path) {
    let where = { port: 80, host: 'grafana.localhost' };
    if (EKS) {
        try {
            where = { port: (await forward('grafana')).port, host: '127.0.0.1' };
        } catch (error) {
            return { status: 0, body: String(error) };
        }
    }
    return new Promise((resolve) => {
        const auth = 'Basic ' + Buffer.from('admin:' + grafanaPassword).toString('base64');
        const req = request({ host: '127.0.0.1', port: where.port, path, headers: { Host: where.host, Authorization: auth } }, (res) => {
            let body = '';
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => resolve({ status: res.statusCode, body }));
        });
        req.on('error', (error) => resolve({ status: 0, body: String(error) }));
        req.end();
    });
}
const dashboardFiles = JSON.parse(kubectl(['get', 'configmap', 'splitx-dashboards', '-n', 'monitoring', '-o', 'json']).stdout || '{"data":{}}').data ?? {};
const committedDashboards = Object.values(dashboardFiles).map((text) => JSON.parse(text));
const served = [];
for (const dashboard of committedDashboards) {
    const answer = await grafana('/api/dashboards/uid/' + dashboard.uid);
    const panelCount = answer.status === 200 ? JSON.parse(answer.body).dashboard.panels.filter((p) => p.type !== 'row').length : 0;
    served.push({ uid: dashboard.uid, title: dashboard.title, status: answer.status, panelCount });
}
const datasourceChecks = [];
for (const uid of dashboardDatasourceUids(root)) {
    datasourceChecks.push({ uid, status: (await grafana('/api/datasources/uid/' + uid)).status });
}
record(
    'Grafana serves the committed dashboards, and every data source they name exists',
    served.length > 0 && served.every((d) => d.status === 200) && datasourceChecks.every((d) => d.status === 200),
    served.map((d) => d.title + ' (' + (d.status === 200 ? d.panelCount + ' panels' : 'HTTP ' + d.status) + ')').join(', ')
        + '; data sources ' + datasourceChecks.map((d) => d.uid + (d.status === 200 ? '' : ' HTTP ' + d.status)).join(', ')
);

// A metric exists if Prometheus has samples of it, or if the application
// declares it: a labelled counter has no samples until its first increment.
const storedNames = new Set((await inCluster('prometheus', '/api/v1/label/__name__/values'))?.data ?? []);
// A pod running now: the release test above replaced every pod it started with.
const currentPod = appPods()[0]?.metadata.name;
const declared = k(['exec', currentPod, '--', 'sh', '-c',
    'wget -qO- --header="Authorization: Bearer $METRICS_TOKEN" http://127.0.0.1:3000/api/metrics | grep "^# TYPE "']).stdout;
for (const [, name, type] of declared.matchAll(/^# TYPE (\S+) (\S+)$/gm)) {
    storedNames.add(name);
    if (type === 'histogram') for (const suffix of ['_bucket', '_sum', '_count']) storedNames.add(name + suffix);
    if (type === 'summary') for (const suffix of ['_sum', '_count']) storedNames.add(name + suffix);
}
const queries = dashboardQueries(root);
// Jenkins' plugin gathers its build metrics every 30 s and Prometheus scrapes
// it every 30 s (helm/platform/jenkins.values.yaml), so a build that ended just
// before this check can take a minute to appear. A name still missing is looked
// for again for up to 90 s before it counts as absent (D-100).
const wanted = [...new Set(queries.flatMap((query) => metricNamesIn(query.expr)))];
await waitFor(async () => {
    for (const name of (await inCluster('prometheus', '/api/v1/label/__name__/values'))?.data ?? []) storedNames.add(name);
    return wanted.every((name) => storedNames.has(name) || FIRST_EVENT_SERIES.has(name));
}, { timeoutMs: 90_000, everyMs: 10_000 });
const queryProblems = [];
// Series that can't exist before their first event (FIRST_EVENT_SERIES): said,
// never counted as present, and never a failure (D-102).
const notYet = new Set();
for (const query of queries) {
    const answer = await promQuery(withoutGrafanaVariables(query.expr));
    if (answer?.status !== 'success') queryProblems.push(query.panel + ': ' + (answer?.error ?? 'no answer'));
    for (const name of metricNamesIn(query.expr)) {
        if (storedNames.has(name)) continue;
        if (FIRST_EVENT_SERIES.has(name)) notYet.add(name);
        else queryProblems.push(query.panel + ': no metric named ' + name);
    }
}
record(
    'Every dashboard query runs, and reads metrics that exist',
    queries.length > 0 && queryProblems.length === 0,
    queryProblems.length
        ? queryProblems.join('; ')
        : queries.length + ' queries on ' + wanted.length + ' metrics'
            + [...notYet].map((name) => '; not published yet: ' + name + ', because ' + FIRST_EVENT_SERIES.get(name)).join('')
);

// Logs: Alloy reads them through the Kubernetes API and ships them to Loki.
const since = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString();
const logLines = (expr, minutes) => inCluster('loki', '/loki/api/v1/query_range?query=' + encodeURIComponent(expr) + '&start=' + since(minutes) + '&limit=20');
const logCount = (expr) => inCluster('loki', '/loki/api/v1/query?query=' + encodeURIComponent(expr));

// Alloy starts following a new pod's log once its container is running,
// retrying with a growing pause until then, and sends lines in batches: the
// pods the release test just started take a few seconds to appear (3 to 8 s
// after their containers started, measured over a rolling restart).
const podsNow = appPods().map((pod) => pod.metadata.name);
const readLogging = async () => {
    const answer = await logCount('count by (pod) (count_over_time({namespace="' + NS + '", app="splitx"} [15m]))');
    return {
        pods: new Set((answer?.data?.result ?? []).map((r) => r.metric.pod)),
        error: answer?.status === 'success' ? null : answer?.error ?? 'no answer',
    };
};
const loggingFrom = Date.now();
const logging = (await waitFor(async () => {
    const now = await readLogging();
    return podsNow.length > 0 && podsNow.every((pod) => now.pods.has(pod)) ? now : null;
}, { timeoutMs: 60_000, everyMs: 3_000 })) ?? (await readLogging());
const loggingSeconds = Math.round((Date.now() - loggingFrom) / 1000);
const everyPodLogging = podsNow.length > 0 && podsNow.every((pod) => logging.pods.has(pod));
record(
    'Every application pod is logging to Loki',
    everyPodLogging,
    podsNow.filter((pod) => logging.pods.has(pod)).length + ' of ' + podsNow.length + ' pods have lines in the last 15 minutes'
        + (logging.error ? '; Loki: ' + logging.error : everyPodLogging ? ', all found within ' + loggingSeconds + ' s' : ' after ' + loggingSeconds + ' s')
);

// One real request, then its ID in the logs. On Kind the ingress's upstream
// address must be the IP of the pod whose line carries the same ID; on EKS the
// load balancer's side isn't in Loki, and the pod whose line carries the ID
// must be the one the answer names.
const traced = await fetch(BASE + '/api/settlements/preview', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scenario: { members: 100 } }),
    signal: AbortSignal.timeout(30_000),
}).catch(() => null);
const tracedId = traced?.headers.get('x-request-id') ?? '';
const tracedBy = traced?.status === 200 ? (await traced.json().catch(() => null))?.data?.servedBy ?? '' : '';
let trace = null;
let tracedPodIp = null;
if (EKS) {
    record('One request can be followed in Loki from the ingress to the pod that served it', null, KIND_ONLY.ingressTrace);
    trace = /^[0-9a-f]{32}$/.test(tracedId) ? await waitFor(async () => {
        const app = (await logLines('{namespace="' + NS + '", app="splitx"} | request_id="' + tracedId + '"', 5))?.data?.result?.[0];
        return app ? { pod: app.stream.pod } : null;
    }, { timeoutMs: 45_000, everyMs: 3_000 }) : null;
    record(
        'A request through the edge is logged, under the ID it was answered with, by the pod that served it',
        Boolean(trace) && trace.pod === tracedBy,
        trace
            ? 'X-Request-Id ' + tracedId + ': answered by ' + tracedBy + ' through CloudFront, and ' + trace.pod + ' logged the same ID'
            : 'request ' + (tracedId || 'without an ID') + ' not found in the application\'s log within 45 s'
    );
} else {
    trace = /^[0-9a-f]{32}$/.test(tracedId) ? await waitFor(async () => {
        const app = (await logLines('{namespace="' + NS + '", app="splitx"} | request_id="' + tracedId + '"', 5))?.data?.result?.[0];
        const edge = (await logLines('{namespace="ingress-nginx"} | request_id="' + tracedId + '"', 5))?.data?.result?.[0];
        return app && edge ? { pod: app.stream.pod, edge: JSON.parse(edge.values[0][1]) } : null;
    }, { timeoutMs: 45_000, everyMs: 3_000 }) : null;
    tracedPodIp = trace ? json(['get', 'pod', trace.pod, '-n', NS]).status?.podIP : null;
    record(
        'One request can be followed in Loki from the ingress to the pod that served it',
        Boolean(trace) && trace.edge.upstream_addr === tracedPodIp + ':3000',
        trace
            ? 'X-Request-Id ' + tracedId + ': ingress-nginx sent it to ' + trace.edge.upstream_addr + ' (' + trace.edge.request_time + ' s at the edge), and '
                + trace.pod + ' at ' + tracedPodIp + ' logged the same ID'
            : 'request ' + (tracedId || 'without an ID') + ' not found in both logs within 45 s'
    );
}

const logQueries = dashboardQueries(root, 'loki');
const logProblems = [];
for (const query of logQueries) {
    const answer = await logLines(query.expr.replaceAll('$request_id', tracedId || '0'), 60);
    if (answer?.status !== 'success') logProblems.push(query.panel + ': ' + (answer?.error ?? 'no answer'));
}
record(
    'Every log dashboard query runs',
    logQueries.length > 0 && logProblems.length === 0,
    logProblems.length ? logProblems.join('; ') : logQueries.length + ' LogQL queries'
);

sections.push({
    title: 'Monitoring',
    body: [
        'kube-prometheus-stack (Prometheus Operator, Prometheus, Alertmanager, Grafana, kube-state-metrics,',
        'node-exporter) runs in its own namespaces. The application ships its own ServiceMonitor and',
        'alert rules (`k8s/base`), and its dashboards come from `monitoring/dashboards`.',
        '',
        '| Scrape job | Namespace | Targets up |',
        '|---|---|---|',
        ...jobs.map((job) => {
            const of = targets.filter((t) => t.labels.job === job);
            return '| `' + job + '` | ' + (of[0]?.labels.namespace ?? '-') + ' | ' + of.filter((t) => t.health === 'up').length + ' of ' + of.length + ' |';
        }),
        '',
        '| SplitX alert | Severity | State now |',
        '|---|---|---|',
        ...splitxRules.map((rule) => '| `' + rule.name + '` | ' + rule.labels.severity + ' | ' + rule.state + ' |'),
        '',
        'Each SplitX rule is unit-tested with promtool in CI (`npm run test:alerts`), against series',
        'that should fire it and series that must not. ' + ruleGroups.flatMap((group) => group.rules).length
            + ' rules are loaded in total, including the Kubernetes defaults.',
        '',
        '| Dashboard | Panels | Queries checked |',
        '|---|---|---|',
        ...served.map((d) => '| ' + d.title + ' | ' + d.panelCount + ' | '
            + (queries.filter((q) => q.uid === d.uid).length + logQueries.filter((q) => q.uid === d.uid).length) + ' |'),
        '',
        EKS
            ? 'Logs: Alloy reads the application\'s log through the Kubernetes API and ships it to Loki, parsing its JSON.'
            : 'Logs: Alloy reads the application and ingress-nginx logs through the Kubernetes API and ships',
        EKS ? 'One request made through CloudFront during this run:' : 'them to Loki, parsing the JSON both write. One request made during this run:',
        '',
        '| | |',
        '|---|---|',
        '| X-Request-Id | `' + (tracedId || '-') + '` |',
        EKS
            ? '| Answered by | `' + (tracedBy || '-') + '` |'
            : '| ingress-nginx access log | ' + (trace ? 'status ' + trace.edge.status + ', ' + trace.edge.request_time + ' s, sent to `' + trace.edge.upstream_addr + '`' : 'not found') + ' |',
        '| Application log | ' + (trace ? '`' + trace.pod + '`' + (tracedPodIp ? ' at `' + tracedPodIp + '`' : '') : 'not found') + ' |',
    ].join('\n'),
});

function spawnAsync(file, argv) {
    return new Promise((resolve) => {
        const child = spawn(file, argv, { cwd: root, shell: false });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => { stdout += chunk; });
        child.stderr.on('data', (chunk) => { stderr += chunk; });
        child.on('close', (code) => resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }));
    });
}

// ── The report ────────────────────────────────────────────────────────────
const releases = sh('helm', ['--kube-context', CONTEXT, 'list', '-A', '-o', 'json']).stdout;
const installed = JSON.parse(releases || '[]').map((r) => '| `' + r.name + '` | ' + r.chart + ' | ' + r.app_version + ' | ' + r.namespace + ' |');
const container = json(['get', 'deployment', 'splitx', '-n', NS]).spec.template.spec.containers[0];
const localCount = (sh('kubectl', ['kustomize', 'k8s/overlays/local']).stdout.match(/^kind: /gm) ?? []).length;
const awsCount = (sh('kubectl', ['kustomize', 'k8s/overlays/aws']).stdout.match(/^kind: /gm) ?? []).length;
const zonesUsed = [...new Set(nodes.map((n) => n.zone))].filter((zone) => zone !== '-').sort();

const report = [
    EKS ? '# Kubernetes on EKS — what the demo platform proves' : '# Kubernetes — what the rehearsal cluster proves',
    '',
    'Written by `scripts/cluster-verify.mjs` (`npm run k8s:verify' + (EKS ? ' -- --target eks' : '') + '`) on ' + new Date().toISOString().slice(0, 10) + '.',
    'Every number here was measured against a running cluster; nothing is asserted about a YAML file.',
    ...(EKS ? ['Visitors\' requests went through ' + BASE + ', as a visitor\'s do. A skipped check has nothing to check here, and says why.'] : []),
    '',
    '## Result',
    '',
    '| Check | Result | Detail |',
    '|---|---|---|',
    ...checks.map((c) => '| ' + c.name + ' | ' + new Map([[true, 'pass'], [false, '**fail**'], [null, 'skipped']]).get(c.passed) + ' | ' + c.detail + ' |'),
    '',
    '## The cluster',
    '',
    EKS
        ? 'EKS in ' + cluster.region + ', Kubernetes ' + nodes[0].version + ': ' + nodes.length + ' nodes in ' + (zonesUsed.join(' and ') || 'no zone')
            + ', built by `terraform/platform` for the day and removed by aws-down.'
        : '`kind` 1 control plane + 2 workers, Kubernetes ' + nodes[0].version + ', pinned by digest in `k8s/kind/cluster.yaml`.',
    EKS
        ? 'The Kind cluster runs the same Kubernetes minor version, so the rehearsals were not a different Kubernetes.'
        : 'The version matches the EKS version the demo will run, so the rehearsal is not a different Kubernetes.',
    '',
    '| Release | Chart | App version | Namespace |',
    '|---|---|---|---|',
    ...installed,
    '',
    'Both are pinned in `helm/platform/charts.json` and configured from a values file per component,',
    'so the same command produces the same cluster on any machine.',
    '',
    '## One base, two environments',
    '',
    '`k8s/base` holds what does not change. `k8s/overlays/local` renders ' + localCount + ' objects (it adds the',
    'in-cluster Postgres and Redis components); `k8s/overlays/aws` renders ' + awsCount + ' (Neon instead of a',
    'database pod, an ALB instead of nginx, network policies with EKS\'s addresses, two proxy hops instead of one).',
    'Render either with `kubectl kustomize k8s/overlays/<name>`.',
    '',
    '| Setting | Value | Why |',
    '|---|---|---|',
    '| CPU request | ' + container.resources.requests.cpu + ' | what the autoscaler measures against |',
    '| CPU limit | ' + (container.resources.limits?.cpu ?? 'none') + ' | a 1-CPU quota made V8\'s compiler and GC threads compete with the main thread; fresh pods stalled for up to 21 s under overload (D-053) |',
    '| Memory request / limit | ' + container.resources.requests.memory + ' / ' + container.resources.limits.memory + ' | measured from a running pod, not guessed |',
    '| Root filesystem | read-only | with `/tmp` and the Next cache as the only writable paths |',
    '| User | ' + (json(['get', 'deployment', 'splitx', '-n', NS]).spec.template.spec.securityContext.runAsUser) + ' (non-root) | enforced by the namespace, not just requested |',
    '',
    ...sections.flatMap((section) => ['## ' + section.title, '', section.body, '']),
].join('\n');

writeFileSync(join(root, target.reports.cluster), report + '\n');
stopForwards();

const skipped = checks.filter((c) => c.passed === null).length;
console.log('\n' + checks.filter((c) => c.passed === true).length + '/' + (checks.length - skipped) + ' checks passed' + (skipped ? ', ' + skipped + ' skipped' : '') + '.');
console.log('Report: ' + target.reports.cluster);
process.exit(failures === 0 ? 0 : 1);
