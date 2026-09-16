#!/usr/bin/env node
/**
 * Brings the local rehearsal cluster up, or brings an existing one in line with
 * the manifests. Safe to run again: every step is idempotent.
 *
 *   node scripts/cluster-up.mjs              create/update the cluster
 *   node scripts/cluster-up.mjs --recreate   delete the cluster first
 *   node scripts/cluster-up.mjs --image splitx:abc1234
 *
 * What it does, and why each step is here rather than in a README:
 *   1. checks the tools it needs, and says which one is missing
 *   2. creates the Kind cluster from k8s/kind/cluster.yaml (1 control plane, 2 workers)
 *   3. installs the pinned platform charts listed in helm/platform/charts.json
 *   4. loads the application image into the nodes — Kind has no registry, and
 *      the manifests never pull, so this is how a build reaches a pod
 *   5. builds the splitx-secrets Secret from .env and pipes it to kubectl.
 *      Values are never written to a file, never passed as an argument and
 *      never printed; only the key names appear in the output.
 *   6. applies k8s/overlays/local and waits for the database, the schema Job
 *      and the deployment
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkNewConnections, describe } from './lib/cluster-network.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLUSTER = 'splitx';
const NAMESPACE = 'splitx';
const OVERLAY = 'k8s/overlays/local';
const CONTEXT = 'kind-splitx';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => {
    const index = args.indexOf(name);
    return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const IMAGE = option('--image', 'splitx:local');

let step = 0;
const heading = (text) => console.log('\n[' + ++step + '] ' + text);
const fail = (message) => {
    console.error('\nx ' + message);
    process.exit(1);
};

function run(file, argv, options = {}) {
    const { input, capture = false, allowFailure = false } = options;
    const result = spawnSync(file, argv, {
        cwd: root,
        input,
        encoding: 'utf8',
        stdio: capture || input !== undefined ? ['pipe', 'pipe', 'pipe'] : 'inherit',
        shell: false,
    });
    if (result.error) fail('could not run ' + file + ': ' + result.error.message);
    if (result.status !== 0 && !allowFailure) {
        if (result.stderr) console.error(result.stderr.trim());
        fail(file + ' ' + argv.slice(0, 3).join(' ') + ' exited ' + result.status);
    }
    return { code: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

const kubectl = (argv, options) => run('kubectl', ['--context', CONTEXT, ...argv], options);

// ── 1. tools ──────────────────────────────────────────────────────────────
heading('Checking tools');
for (const tool of ['docker', 'kind', 'kubectl', 'helm']) {
    const probe = spawnSync(tool, ['version'], { encoding: 'utf8', shell: false });
    if (probe.error) fail(tool + ' is not on PATH. See README, "Kubernetes".');
    console.log('    ' + tool + ' ok');
}

// ── 2. cluster ────────────────────────────────────────────────────────────
heading('Cluster "' + CLUSTER + '"');
const existing = run('kind', ['get', 'clusters'], { capture: true, allowFailure: true }).stdout.split(/\r?\n/);
const alreadyThere = existing.includes(CLUSTER);
if (alreadyThere && flag('--recreate')) {
    console.log('    deleting the existing cluster (--recreate)');
    run('kind', ['delete', 'cluster', '--name', CLUSTER]);
}
if (!alreadyThere || flag('--recreate')) {
    run('kind', ['create', 'cluster', '--config', 'k8s/kind/cluster.yaml', '--wait', '180s']);
} else {
    console.log('    already exists, leaving it alone');
}
console.log(kubectl(['get', 'nodes', '-o', 'wide'], { capture: true }).stdout.trim());

// ── 3. platform charts ────────────────────────────────────────────────────
heading('Platform charts (pinned in helm/platform/charts.json)');
const { charts } = JSON.parse(readFileSync(join(root, 'helm/platform/charts.json'), 'utf8'));
for (const chart of charts) {
    run('helm', ['repo', 'add', chart.chart.split('/')[0], chart.repo], { capture: true, allowFailure: true });
}
run('helm', ['repo', 'update'], { capture: true });
for (const chart of charts) {
    console.log('    ' + chart.release + ' ' + chart.version + ' -> ' + chart.namespace);
    run('helm', [
        '--kube-context', CONTEXT,
        'upgrade', '--install', chart.release, chart.chart,
        '--version', chart.version,
        '--namespace', chart.namespace, '--create-namespace',
        '--values', chart.values,
        '--wait', '--timeout', '6m',
    ], { capture: true });
}

// ── 4. image ──────────────────────────────────────────────────────────────
heading('Image ' + IMAGE);
const known = run('docker', ['image', 'inspect', IMAGE, '--format', '{{.Id}}'], { capture: true, allowFailure: true });
if (known.code !== 0) {
    if (IMAGE !== 'splitx:local') fail(IMAGE + ' is not in the local image store. Build it first: npm run image:build');
    console.log('    not built yet, running scripts/image-build.mjs');
    run(process.execPath, ['scripts/image-build.mjs']);
}
// Kind nodes keep their own containerd store. Without this the kubelet would
// try to pull splitx:local from Docker Hub, where it does not exist.
run('kind', ['load', 'docker-image', IMAGE, '--name', CLUSTER]);
console.log('    ' + IMAGE + ' is now on every node');

// ── 5. secret ─────────────────────────────────────────────────────────────
heading('Secret splitx-secrets (built from .env)');
if (!existsSync(join(root, '.env'))) fail('.env not found. Copy .env.example and fill it in.');
process.loadEnvFile(join(root, '.env'));

const REQUIRED = ['POSTGRES_PASSWORD', 'REDIS_PASSWORD', 'METRICS_TOKEN', 'NEXTAUTH_SECRET'];
const OPTIONAL = [
    'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'GEMINI_API_KEY',
    'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GITHUB_ID', 'GITHUB_SECRET',
    'RESEND_API_KEY', 'EMAIL_FROM',
];
const missing = REQUIRED.filter((key) => !process.env[key]);
if (missing.length) fail('.env is missing: ' + missing.join(', '));

// Percent-encoded: a password containing @ or / would otherwise split the URL
// and the pods would connect somewhere else, or nowhere at all.
const pgPassword = encodeURIComponent(process.env.POSTGRES_PASSWORD);
const redisPassword = encodeURIComponent(process.env.REDIS_PASSWORD);
const pgBase = 'postgresql://splitx:' + pgPassword + '@splitx-postgres:5432/splitx';

const stringData = {
    // Built here, never read from .env. The DATABASE_URL in .env points at the
    // Compose Postgres on localhost, which inside a pod means the pod itself —
    // and the Neon URL sits one comment character above it in the same file, so
    // a file edited in a hurry could otherwise aim the rehearsal cluster at the
    // deployed site's data, including the test that scales the database to zero.
    // connection_limit is explicit because ten pods with Prisma's default pool
    // would exhaust a small database (B-010).
    DATABASE_URL: pgBase + '?connection_limit=5&pool_timeout=10',
    DIRECT_URL: pgBase,
    REDIS_URL: 'redis://:' + redisPassword + '@splitx-redis:6379/0',
    ...Object.fromEntries(
        [...REQUIRED, ...OPTIONAL].filter((key) => process.env[key]).map((key) => [key, process.env[key]])
    ),
};

kubectl(['apply', '-f', 'k8s/base/namespace.yaml'], { capture: true });
kubectl(['apply', '-f', '-'], {
    input: JSON.stringify({
        apiVersion: 'v1',
        kind: 'Secret',
        metadata: {
            name: 'splitx-secrets',
            namespace: NAMESPACE,
            labels: { 'app.kubernetes.io/part-of': 'splitx' },
        },
        type: 'Opaque',
        stringData,
    }),
});
console.log('    ' + Object.keys(stringData).length + ' keys: ' + Object.keys(stringData).sort().join(', '));

// ── 6. manifests ──────────────────────────────────────────────────────────
heading('Applying ' + OVERLAY);
// A Job's pod template is immutable, so a changed schema.sql would make apply
// fail. The Job is disposable, and deleting it is how it gets updated.
kubectl(['delete', 'job', 'splitx-schema-init', '-n', NAMESPACE, '--ignore-not-found'], { capture: true });
kubectl(['apply', '-k', OVERLAY]);

heading('Waiting for the database, the schema and the app');
kubectl(['-n', NAMESPACE, 'rollout', 'status', 'statefulset/splitx-postgres', '--timeout=240s']);
kubectl(['-n', NAMESPACE, 'rollout', 'status', 'deployment/splitx-redis', '--timeout=120s']);
kubectl(['-n', NAMESPACE, 'wait', '--for=condition=complete', 'job/splitx-schema-init', '--timeout=240s']);
kubectl(['-n', NAMESPACE, 'rollout', 'status', 'deployment/splitx', '--timeout=300s']);

heading('Can the pods open new connections?');
// Readiness can pass on connections a pod opened before something broke, so it
// cannot answer this. After a host restart Kind's network-policy engine can keep
// stale state and drop every new pod connection while old ones keep working
// (D-044); restarting kindnet rebuilds that state.
const capture = (argv) => kubectl(argv, { capture: true, allowFailure: true });
let network = checkNewConnections(capture);
if (!network.every((result) => result.ok)) {
    console.log(describe(network));
    console.log('    new connections are being dropped; restarting kindnet to rebuild its policy state');
    kubectl(['-n', 'kube-system', 'rollout', 'restart', 'daemonset/kindnet'], { capture: true });
    kubectl(['-n', 'kube-system', 'rollout', 'status', 'daemonset/kindnet', '--timeout=180s'], { capture: true });
    await new Promise((resolve) => setTimeout(resolve, 10_000));
    network = checkNewConnections(capture);
    if (!network.every((result) => result.ok)) {
        console.log(describe(network));
        fail('pods still cannot open new connections. Rebuild the cluster: npm run k8s:up -- --recreate');
    }
    console.log('    recovered after restarting kindnet');
}
console.log(describe(network).replace(/^/gm, '    '));

heading('Cluster state');
console.log(kubectl(['-n', NAMESPACE, 'get', 'pods', '-o', 'wide'], { capture: true }).stdout.trim());
console.log('');
console.log(kubectl(['-n', NAMESPACE, 'get', 'hpa,ingress'], { capture: true }).stdout.trim());

console.log('\nReady: http://localhost/   Evidence pass: npm run k8s:verify');
