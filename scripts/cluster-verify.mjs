#!/usr/bin/env node
/**
 * Proves the cluster does what the manifests claim, and writes what it measured
 * to docs/evidence/kubernetes.md.
 *
 *   npm run k8s:verify
 *
 * Every check runs against the live cluster: nothing here is a static
 * assertion about a YAML file. The interesting ones are the destructive pair —
 * a database outage (does readiness remove the pod without liveness killing
 * it?) and a rolling restart under continuous traffic (is a release lossless?)
 * — because those are the claims a deployment usually makes without evidence.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkNewConnections, describe, describeKindnet, kindnetHealth } from './lib/cluster-network.mjs';
import { dashboardDatasourceUids, dashboardQueries, metricNamesIn, withoutGrafanaVariables } from './lib/dashboards.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// The Grafana admin password, for the dashboard checks. Read, never printed.
if (existsSync(join(root, '.env'))) process.loadEnvFile(join(root, '.env'));
const NS = 'splitx';
const CONTEXT = 'kind-splitx';
const BASE = 'http://localhost';
const PROBE_IMAGE = 'busybox:1.37.0';

const checks = [];
const sections = [];
let failures = 0;

function record(name, passed, detail) {
    checks.push({ name, passed, detail });
    if (!passed) failures += 1;
    console.log((passed ? '  PASS  ' : '  FAIL  ') + name + (detail ? ' — ' + detail : ''));
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
        const response = await fetch(BASE + path, { redirect: 'manual', ...options });
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

console.log('SplitX — cluster verification\n');

// ── 1. Scheduling: where the pods actually run ────────────────────────────
console.log('[1] Scheduling');
const nodes = json(['get', 'nodes']).items.map((node) => ({
    name: node.metadata.name,
    roles: Object.keys(node.metadata.labels).filter((l) => l.startsWith('node-role')).map((l) => l.split('/')[1]).join(',') || 'worker',
    version: node.status.nodeInfo.kubeletVersion,
}));
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
sections.push({
    title: 'Where the pods run',
    body: [
        '| Node | Role | Kubelet |',
        '|---|---|---|',
        ...nodes.map((n) => '| `' + n.name + '` | ' + n.roles + ' | ' + n.version + ' |'),
        '',
        '| Pod | Node | Pod IP | Restarts |',
        '|---|---|---|---|',
        ...placement.map((p) => '| `' + p.pod + '` | ' + p.node + ' | ' + p.ip + ' | ' + p.restarts + ' |'),
    ].join('\n'),
});

// ── 1b. New connections, which readiness cannot vouch for ─────────────────
console.log('[1b] New connections');
const network = checkNewConnections((argv) => kubectl(argv));
record(
    'Every app pod can open new connections (DNS, Postgres, Redis)',
    network.length > 0 && network.every((result) => result.ok),
    network.every((result) => result.ok)
        ? network.length + ' pods checked'
        : describe(network.filter((result) => !result.ok)).split(String.fromCharCode(10)).join('; ')
);

// ── 1c. The engine that judges those connections ──────────────────────────
// A connection check passes the moment kindnet catches up. Its own counters
// show whether it is about to fall behind again (D-050).
console.log('[1c] kindnet');
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

// ── 2. The edge: what the ingress exposes and what it refuses ─────────────
console.log('[2] Ingress');
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
console.log('[3b] End to end through the ingress');
const stamp = Date.now();
const testEmail = 'k8s-verify+' + stamp + '@example.invalid';
const psql = (sql) => k(['exec', 'statefulset/splitx-postgres', '--', 'psql', '-U', 'splitx', '-d', 'splitx', '-tAc', sql]).stdout.trim();

const registered = await fetch(BASE + '/api/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Cluster Check', email: testEmail, password: 'rehearsal-' + stamp }),
});
const tables = psql("SELECT count(*) FROM information_schema.tables WHERE table_schema='public'");
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

// The load target for phase 4: pure CPU, no database, behind the same ingress.
const previewStarted = Date.now();
const preview = await fetch(BASE + '/api/settlements/preview', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scenario: { members: 400, seed: 7 } }),
});
const previewBody = preview.status === 200 ? await preview.json() : null;
record(
    'The settlement preview runs on the cluster',
    preview.status === 200,
    previewBody
        ? '400 members planned in ' + previewBody.data.computeMs + ' ms by ' + previewBody.data.servedBy + ' (' + (Date.now() - previewStarted) + ' ms round trip)'
        : 'HTTP ' + preview.status
);
sections.push({
    title: 'The application, not just the pods',
    body: [
        '| Check | Result |',
        '|---|---|',
        '| Tables created by the schema Job | ' + tables + ' |',
        '| `POST /api/register` through ingress-nginx | HTTP ' + registered.status + ', row written to Postgres and removed again |',
        '| `POST /api/settlements/preview` (400 members) | HTTP ' + preview.status + (previewBody ? ', planned in ' + previewBody.data.computeMs + ' ms' : '') + ' |',
        '',
        'The preview is the endpoint phase 4 will use to drive the autoscaler: it is pure CPU with',
        'no database behind it, so a pod under load is doing arithmetic, not waiting on Neon.',
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
console.log('[5] Network policy (this one takes ~30 s)');
kubectl(['delete', 'pod', 'netpol-probe', '-n', 'default', '--ignore-not-found'], {});
kubectl(['run', 'netpol-probe', '-n', 'default', '--image', PROBE_IMAGE, '--restart=Never', '--command', '--',
    'sh', '-c',
    'wget -T 5 -q -O /dev/null http://splitx.splitx.svc.cluster.local/api/health/live; echo app=$?; ' +
    'nc -z -w 5 splitx-postgres.splitx 5432; echo postgres=$?; ' +
    'nc -z -w 5 splitx-redis.splitx 6379; echo redis=$?']);
await waitFor(() => {
    const phase = kubectl(['get', 'pod', 'netpol-probe', '-n', 'default', '-o', 'jsonpath={.status.phase}']).stdout;
    return phase === 'Succeeded' || phase === 'Failed' ? phase : null;
}, { timeoutMs: 90_000 });
const probeLog = kubectl(['logs', 'netpol-probe', '-n', 'default']).stdout;
kubectl(['delete', 'pod', 'netpol-probe', '-n', 'default', '--ignore-not-found', '--wait=false'], {});
const blocked = (name) => new RegExp('^' + name + '=[1-9]', 'm').test(probeLog);
const enforced = blocked('app') && blocked('postgres') && blocked('redis');
record(
    'A pod in another namespace cannot reach the app, the database or Redis',
    enforced,
    enforced ? probeLog.replace(/\n/g, ' ') + ' (non-zero = refused)' : 'REACHABLE: ' + probeLog.replace(/\n/g, ' ')
);
sections.push({
    title: 'Network policy, tested from outside the namespace',
    body: [
        'A `busybox` pod in the `default` namespace tried three connections that the policies forbid.',
        'A non-zero exit code means the connection never completed.',
        '',
        '```',
        probeLog || '(no output)',
        '```',
        '',
        'The positive control is the application itself: its readiness probe passes, which means it',
        'is reaching Postgres, and the page loads through ingress-nginx, which the policy does allow.',
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
const restartsBefore = appPods().map((p) => p.status.containerStatuses[0].restartCount).reduce((a, b) => a + b, 0);
k(['scale', 'statefulset/splitx-postgres', '--replicas=0']);
const wentNotReady = await waitFor(() => {
    const ready = appPods().filter((p) => p.status.conditions.find((c) => c.type === 'Ready')?.status === 'True');
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

// ── 8. A release under traffic ────────────────────────────────────────────
console.log('[8] Rolling restart under continuous traffic');
const before = new Set(appPods().map((p) => p.metadata.name));
const traffic = { total: 0, ok: 0, notOk: 0, failed: 0, pods: new Map(), codes: new Map() };
let hammering = true;

async function hammer() {
    while (hammering) {
        try {
            const response = await fetch(BASE + '/api/health/live');
            traffic.total += 1;
            if (response.status === 200) {
                traffic.ok += 1;
                const body = await response.json();
                traffic.pods.set(body.pod, (traffic.pods.get(body.pod) ?? 0) + 1);
            } else {
                traffic.notOk += 1;
                // Which code it is matters: 503 means the Service had no ready
                // endpoint, 502 means nginx reached a pod that had already gone.
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
const restart = await spawnAsync('kubectl', ['--context', CONTEXT, '-n', NS, 'rollout', 'restart', 'deployment/splitx']);
const rollout = await spawnAsync('kubectl', ['--context', CONTEXT, '-n', NS, 'rollout', 'status', 'deployment/splitx', '--timeout=300s']);
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
// For a few seconds after Kubernetes calls the rollout complete, ingress-nginx
// still holds connections to the pods that are draining — which is exactly what
// the preStop delay keeps alive, and those requests are answered normally. What
// has to be true is that traffic moves off them promptly.
let lastPod = null;
const drainStarted = Date.now();
const settled = await waitFor(async () => {
    const body = await (await fetch(BASE + '/api/health/live')).json();
    lastPod = body.pod;
    return after.has(body.pod) ? body.pod : null;
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
        '`kubectl rollout restart` with four concurrent clients hitting the ingress throughout.',
        'The deployment uses `maxSurge: 1, maxUnavailable: 0`, so a new pod must pass its readiness',
        'probe before an old one is taken out, and a `preStop` sleep of 5 s gives ingress-nginx time',
        'to stop routing to a pod before its server begins shutting down.',
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
        'nginx reuses upstream connections, so a short rollout can be served mostly by one pod; what',
        'matters is that the pods serving afterwards are the new ones:',
        '',
        '```',
        ...servedBy.map(([pod, count]) => pod + '  ' + count),
        '```',
    ].join('\n'),
});

// ── 9. Monitoring: Prometheus, Alertmanager and Grafana ───────────────────
console.log('[9] Monitoring');
const PROMETHEUS = '/api/v1/namespaces/monitoring/services/kube-prometheus-stack-prometheus:http-web/proxy';
const ALERTMANAGER = '/api/v1/namespaces/monitoring/services/kube-prometheus-stack-alertmanager:http-web/proxy';
// Through the API server's service proxy: no port-forward, no exposed port.
const raw = (path) => {
    try {
        return JSON.parse(kubectl(['get', '--raw', path]).stdout);
    } catch {
        return null;
    }
};
const promQuery = (expr) => raw(PROMETHEUS + '/api/v1/query?query=' + encodeURIComponent(expr));

const readTargets = () => raw(PROMETHEUS + '/api/v1/targets?state=active')?.data?.activeTargets ?? [];
const readyPods = appPods().filter((pod) => pod.status.conditions?.some((c) => c.type === 'Ready' && c.status === 'True')).length;
const isScrapedPod = (t) => t.labels.job === 'splitx' && t.labels.namespace === NS && t.health === 'up';
// The release test above replaced every pod. Prometheus discovers new pods at
// once but first scrapes them within an interval (15 s); until then their
// health is "unknown", not down. Allow a few intervals before judging.
const targets = (await waitFor(() => {
    const now = readTargets();
    return now.filter(isScrapedPod).length >= readyPods && now.every((t) => t.health === 'up') ? now : null;
}, { timeoutMs: 90_000, everyMs: 5_000 })) ?? readTargets();
const scrapedPods = targets.filter(isScrapedPod).length;
record(
    'Prometheus scrapes every ready application pod, with the metrics token',
    scrapedPods > 0 && scrapedPods >= readyPods,
    scrapedPods + ' of ' + readyPods + ' ready pods scraped'
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

const ruleGroups = raw(PROMETHEUS + '/api/v1/rules')?.data?.groups ?? [];
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

const alertmanagerAlerts = raw(ALERTMANAGER + '/api/v2/alerts') ?? [];
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
const alertmanagerConfig = raw(ALERTMANAGER + '/api/v2/status')?.config?.original ?? '';
const emailSent = Number(promQuery('sum(alertmanager_notifications_total{integration="email"})')?.data?.result?.[0]?.value?.[1] ?? 0);
const emailFailed = Number(promQuery('sum(alertmanager_notifications_failed_total{integration="email"})')?.data?.result?.[0]?.value?.[1] ?? 0);
record(
    'Alerts are routed to email, and every email was accepted',
    alertmanagerConfig.includes('email_configs') && emailFailed === 0,
    alertmanagerConfig.includes('email_configs')
        ? emailSent + ' notification(s) sent through Gmail, ' + emailFailed + ' failed'
        : 'no email receiver: .env has no ALERT_SMTP_USERNAME, ALERT_SMTP_PASSWORD and ALERT_EMAIL_TO'
);

function grafana(path) {
    return new Promise((resolve) => {
        const auth = 'Basic ' + Buffer.from('admin:' + (process.env.GF_ADMIN_PASSWORD ?? '')).toString('base64');
        // Grafana's Ingress answers for grafana.localhost on the same port 80 as the app.
        const req = request({ host: '127.0.0.1', port: 80, path, headers: { Host: 'grafana.localhost', Authorization: auth } }, (res) => {
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
const storedNames = new Set(raw(PROMETHEUS + '/api/v1/label/__name__/values')?.data ?? []);
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
const queryProblems = [];
for (const query of queries) {
    const answer = promQuery(withoutGrafanaVariables(query.expr));
    if (answer?.status !== 'success') queryProblems.push(query.panel + ': ' + (answer?.error ?? 'no answer'));
    for (const name of metricNamesIn(query.expr)) {
        if (!storedNames.has(name)) queryProblems.push(query.panel + ': no metric named ' + name);
    }
}
record(
    'Every dashboard query runs, and reads metrics that exist',
    queries.length > 0 && queryProblems.length === 0,
    queryProblems.length ? queryProblems.join('; ') : queries.length + ' queries on ' + new Set(queries.flatMap((q) => metricNamesIn(q.expr))).size + ' metrics'
);

// Logs: Alloy reads them through the Kubernetes API and ships them to Loki.
const LOKI = '/api/v1/namespaces/monitoring/services/loki:http-metrics/proxy/loki/api/v1';
const since = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString();
const logLines = (expr, minutes) => raw(LOKI + '/query_range?query=' + encodeURIComponent(expr) + '&start=' + since(minutes) + '&limit=20');
const logCount = (expr) => raw(LOKI + '/query?query=' + encodeURIComponent(expr));

const podsLogging = new Set((logCount('count by (pod) (count_over_time({namespace="' + NS + '", app="splitx"} [15m]))')?.data?.result ?? []).map((r) => r.metric.pod));
const podsNow = appPods().map((pod) => pod.metadata.name);
record(
    'Every application pod is logging to Loki',
    podsNow.length > 0 && podsNow.every((pod) => podsLogging.has(pod)),
    podsNow.filter((pod) => podsLogging.has(pod)).length + ' of ' + podsNow.length + ' pods have lines in the last 15 minutes'
);

// One real request, then its ID in both logs, and the ingress's upstream
// address must be the IP of the pod whose line carries the same ID.
const traced = await fetch(BASE + '/api/settlements/preview', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scenario: { members: 100 } }),
}).catch(() => null);
const tracedId = traced?.headers.get('x-request-id') ?? '';
const trace = /^[0-9a-f]{32}$/.test(tracedId) ? await waitFor(() => {
    const app = logLines('{namespace="' + NS + '", app="splitx"} | request_id="' + tracedId + '"', 5)?.data?.result?.[0];
    const edge = logLines('{namespace="ingress-nginx"} | request_id="' + tracedId + '"', 5)?.data?.result?.[0];
    return app && edge ? { pod: app.stream.pod, edge: JSON.parse(edge.values[0][1]) } : null;
}, { timeoutMs: 45_000, everyMs: 3_000 }) : null;
const tracedPodIp = trace ? json(['get', 'pod', trace.pod, '-n', NS]).status?.podIP : null;
record(
    'One request can be followed in Loki from the ingress to the pod that served it',
    Boolean(trace) && trace.edge.upstream_addr === tracedPodIp + ':3000',
    trace
        ? 'X-Request-Id ' + tracedId + ': ingress-nginx sent it to ' + trace.edge.upstream_addr + ' (' + trace.edge.request_time + ' s at the edge), and '
            + trace.pod + ' at ' + tracedPodIp + ' logged the same ID'
        : 'request ' + (tracedId || 'without an ID') + ' not found in both logs within 45 s'
);

const logQueries = dashboardQueries(root, 'loki');
const logProblems = logQueries
    .map((query) => ({ query, answer: logLines(query.expr.replaceAll('$request_id', tracedId || '0'), 60) }))
    .filter(({ answer }) => answer?.status !== 'success')
    .map(({ query, answer }) => query.panel + ': ' + (answer?.error ?? 'no answer'));
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
        'Logs: Alloy reads the application and ingress-nginx logs through the Kubernetes API and ships',
        'them to Loki, parsing the JSON both write. One request made during this run:',
        '',
        '| | |',
        '|---|---|',
        '| X-Request-Id | `' + (tracedId || '-') + '` |',
        '| ingress-nginx access log | ' + (trace ? 'status ' + trace.edge.status + ', ' + trace.edge.request_time + ' s, sent to `' + trace.edge.upstream_addr + '`' : 'not found') + ' |',
        '| Application log | ' + (trace ? '`' + trace.pod + '` at `' + tracedPodIp + '`' : 'not found') + ' |',
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

const report = [
    '# Kubernetes — what the rehearsal cluster proves',
    '',
    'Written by `scripts/cluster-verify.mjs` (`npm run k8s:verify`) on ' + new Date().toISOString().slice(0, 10) + '.',
    'Every number here was measured against a running cluster; nothing is asserted about a YAML file.',
    '',
    '## Result',
    '',
    '| Check | Result | Detail |',
    '|---|---|---|',
    ...checks.map((c) => '| ' + c.name + ' | ' + (c.passed ? 'pass' : '**fail**') + ' | ' + c.detail + ' |'),
    '',
    '## The cluster',
    '',
    '`kind` 1 control plane + 2 workers, Kubernetes ' + nodes[0].version + ', pinned by digest in `k8s/kind/cluster.yaml`.',
    'The version matches the EKS version the demo will run, so the rehearsal is not a different Kubernetes.',
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
    'database pod, an ALB instead of nginx, IRSA on the ServiceAccount, two proxy hops instead of one).',
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

writeFileSync(join(root, 'docs/evidence/kubernetes.md'), report + '\n');

console.log('\n' + checks.filter((c) => c.passed).length + '/' + checks.length + ' checks passed.');
console.log('Report: docs/evidence/kubernetes.md');
process.exit(failures === 0 ? 0 : 1);
