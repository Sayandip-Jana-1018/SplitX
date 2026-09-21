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
 *   2. creates the Kind cluster from k8s/kind/cluster.yaml (1 control plane, 2 workers),
 *      or wakes it if k8s:pause put it to sleep, and caps the CPU its nodes may
 *      take from the laptop (2 + 4 + 4)
 *   3. lifts kindnet's CPU limit: it decides every new pod connection, and at
 *      Kind's default limits it falls behind until new connections time out
 *   4. creates the platform namespaces with their Pod Security levels, and the
 *      Secrets the platform charts read: the Grafana admin password, the
 *      Alertmanager configuration filled with the ALERT_* values from .env, and
 *      Jenkins' admin password, webhook secret and relay settings (the random
 *      ones are generated into .env on the first run)
 *   5. installs the pinned platform charts listed in helm/platform/charts.json
 *   6. loads the application image into the nodes — Kind has no registry, and
 *      the manifests never pull, so this is how a build reaches a pod
 *   7. builds the splitx-secrets Secret from .env and pipes it to kubectl.
 *      Values are never written to a file, never passed as an argument and
 *      never printed; only the key names appear in the output.
 *   8. applies k8s/overlays/local, the Grafana dashboards, the admission policy
 *      (policy/) and what Jenkins needs beyond its chart (jenkins/), and waits
 *      for the database, the schema Job and the deployment
 *   9. rolls the deployment if the pods run an older build than the one loaded
 *  10. opens fresh connections from every pod, because readiness cannot prove it
 */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
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
    // One put to sleep with k8s:pause is woken first; nothing below can reach
    // an API server whose node is stopped (D-062).
    const states = ['control-plane', 'worker', 'worker2'].map((name) =>
        run('docker', ['inspect', CLUSTER + '-' + name, '--format', '{{.State.Status}}'], { capture: true, allowFailure: true }).stdout.trim());
    if (states.some((state) => state !== 'running')) {
        console.log('    asleep (' + states.join(', ') + '): waking it');
        run(process.execPath, ['scripts/cluster-power.mjs', 'resume']);
    }
}
console.log(kubectl(['get', 'nodes', '-o', 'wide'], { capture: true }).stdout.trim());

// The nodes are containers on a laptop that also runs the desktop, an editor
// and a browser. Nothing inside has a CPU limit, on purpose (D-050, D-053), so a
// cold start — Grafana migrating its database, Jenkins loading 81 plugins, every
// controller re-listing at once — took 9 of the machine's 24 threads on one node
// and the desktop stalled with it. The budget goes on the node containers
// instead: inside, pods still share by their requests; outside, the desktop
// keeps the rest (D-062). Docker keeps the setting when a node restarts.
// Kind creates the nodes with the restart policy on-failure, and Docker Desktop's
// shutdown counts as a failure, so the whole cluster came back every time Docker
// started, whether anyone wanted it or not. On 2026-09-21 it ran unnoticed in the
// background until its VM had filled its swap. The nodes start only when asked:
// k8s:up or k8s:resume.
const NODE_CPUS = { [CLUSTER + '-control-plane']: 2, [CLUSTER + '-worker']: 4, [CLUSTER + '-worker2']: 4 };
for (const [node, cpus] of Object.entries(NODE_CPUS)) {
    const [nanoCpus, restart] = run('docker', ['inspect', node, '--format', '{{.HostConfig.NanoCpus}} {{.HostConfig.RestartPolicy.Name}}'], { capture: true }).stdout.trim().split(' ');
    const now = Number(nanoCpus) / 1e9;
    if (now !== cpus || restart !== 'no') run('docker', ['update', '--cpus', String(cpus), '--restart', 'no', node], { capture: true });
    console.log('    ' + node + ': ' + cpus + ' CPUs' + (now === cpus ? '' : ' (was ' + (now || 'unlimited') + ')')
        + ', starts only when asked' + (restart === 'no' ? '' : ' (was restart ' + restart + ')'));
}

// ── 3. pod networking ─────────────────────────────────────────────────────
heading('kindnet resources');
// With network policies in place, kindnet is asked for a verdict on every new
// pod connection. Kind installs it with a 100m CPU limit and 50Mi of memory; on
// this cluster it was throttled in 99.9% of CPU periods, sat at its memory
// limit, and new connections timed out waiting in its queue while established
// ones kept flowing (D-050). The CPU limit goes, the request stays for
// scheduling, and memory keeps a ceiling with room to spare.
const KINDNET_RESOURCES = { limits: { memory: '256Mi' }, requests: { cpu: '100m', memory: '50Mi' } };
// The replacer lists every key once and fixes their order, so the comparison
// does not depend on how the API server orders the object.
const canonical = (resources) => JSON.stringify(resources, ['limits', 'requests', 'cpu', 'memory']);
const kindnetNow = kubectl(['-n', 'kube-system', 'get', 'daemonset', 'kindnet', '-o', 'jsonpath={.spec.template.spec.containers[0].resources}'], { capture: true }).stdout;
if (canonical(JSON.parse(kindnetNow || '{}')) === canonical(KINDNET_RESOURCES)) {
    console.log('    already ' + canonical(KINDNET_RESOURCES));
} else {
    console.log('    was ' + kindnetNow + ', now ' + canonical(KINDNET_RESOURCES));
    const patch = [{ op: 'replace', path: '/spec/template/spec/containers/0/resources', value: KINDNET_RESOURCES }];
    kubectl(['-n', 'kube-system', 'patch', 'daemonset', 'kindnet', '--type=json', '-p', JSON.stringify(patch)], { capture: true });
    kubectl(['-n', 'kube-system', 'rollout', 'status', 'daemonset/kindnet', '--timeout=180s']);
}

// ── 4. platform namespaces and the Secrets the charts read ────────────────
heading('Platform namespaces, and the Secrets the platform charts read');
if (!existsSync(join(root, '.env'))) fail('.env not found. Copy .env.example and fill it in.');
process.loadEnvFile(join(root, '.env'));
// Created with their Pod Security labels before any chart installs into them.
kubectl(['apply', '-f', 'helm/platform/namespaces.yaml'], { capture: true });

// Values are piped to kubectl on stdin: never a file, an argument or output.
const applySecret = (namespace, name, stringData) => kubectl(['apply', '-f', '-'], {
    input: JSON.stringify({
        apiVersion: 'v1',
        kind: 'Secret',
        metadata: { name, namespace, labels: { 'app.kubernetes.io/part-of': 'splitx' } },
        type: 'Opaque',
        stringData,
    }),
});

if (!process.env.GF_ADMIN_PASSWORD) fail('.env is missing: GF_ADMIN_PASSWORD (the Grafana admin password)');
applySecret('monitoring', 'grafana-admin', { 'admin-user': 'admin', 'admin-password': process.env.GF_ADMIN_PASSWORD });
console.log('    grafana-admin: the admin password from GF_ADMIN_PASSWORD');

// The routing tree is committed; the addresses and the SMTP password are not.
const ALERT_KEYS = ['ALERT_SMTP_USERNAME', 'ALERT_SMTP_PASSWORD', 'ALERT_EMAIL_TO'];
let alertmanagerConfig = readFileSync(join(root, 'monitoring/alertmanager/alertmanager.yaml'), 'utf8');
const unsetAlertKeys = ALERT_KEYS.filter((key) => !process.env[key]);
if (unsetAlertKeys.length) {
    // The email integration is the last block in the file. Without it the
    // receiver still exists, so routing works and alerts show in Grafana.
    const lines = alertmanagerConfig.slice(0, alertmanagerConfig.indexOf('\n    email_configs:')).split('\n');
    while (lines.at(-1).trim().startsWith('#')) lines.pop();
    alertmanagerConfig = lines.join('\n') + '\n';
    console.log('    alertmanager-splitx: alerts fire but are NOT emailed; .env is missing ' + unsetAlertKeys.join(', '));
} else {
    for (const key of ALERT_KEYS) {
        // Google shows an App Password in groups of four; the spaces are not part of it.
        const value = key === 'ALERT_SMTP_PASSWORD' ? process.env[key].replace(/\s+/g, '') : process.env[key];
        // JSON strings are valid YAML double-quoted scalars, whatever the value holds.
        alertmanagerConfig = alertmanagerConfig.split('${' + key + '}').join(JSON.stringify(value));
    }
    console.log('    alertmanager-splitx: alerts are emailed to ALERT_EMAIL_TO through Gmail');
}
if (/\$\{[A-Z_]+\}/.test(alertmanagerConfig)) fail('monitoring/alertmanager/alertmanager.yaml has a placeholder k8s:up does not fill');
applySecret('monitoring', 'alertmanager-splitx', { 'alertmanager.yaml': alertmanagerConfig });

// Jenkins (D-055) and the webhook relay (D-056). Three values are random and
// nobody has to choose them, so the first run generates them into .env: they
// survive a cluster rebuild, and the owner reads them there (the admin password
// to log in; the webhook secret and the smee.io channel for the repository's
// webhook settings). Only their names are printed.
const generated = [];
function ensureEnv(key, value, comment) {
    if (process.env[key]) return;
    appendFileSync(join(root, '.env'), '\n# ' + comment + ' (generated by npm run k8s:up)\n' + key + '=' + value + '\n');
    process.env[key] = value;
    generated.push(key);
}
ensureEnv('JENKINS_ADMIN_PASSWORD', randomBytes(18).toString('base64url'), 'Jenkins admin password, user admin, at http://jenkins.localhost');
ensureEnv('GITHUB_WEBHOOK_SECRET', randomBytes(32).toString('hex'), 'The Secret of the repository webhook that announces deployments to Jenkins');
ensureEnv('JENKINS_TRIGGER_TOKEN', randomBytes(24).toString('hex'), 'The token the webhook relay presents to Jenkins');
if (!process.env.SMEE_URL) {
    // smee.io answers /new with a redirect to a fresh channel.
    const channel = await fetch('https://smee.io/new', { redirect: 'manual' })
        .then((res) => res.headers.get('location'))
        .catch(() => null);
    if (!channel?.startsWith('https://smee.io/')) fail('could not create a smee.io channel; set SMEE_URL in .env to one from https://smee.io/new');
    ensureEnv('SMEE_URL', channel, 'The smee.io channel: the Payload URL of the repository webhook');
}
if (generated.length) console.log('    generated into .env: ' + generated.join(', '));
// JCasC reads these when Jenkins starts, so a changed value restarts it (step 5).
const jenkinsSecretsChanged = [
    applySecret('jenkins', 'jenkins-admin', { 'jenkins-admin-user': 'admin', 'jenkins-admin-password': process.env.JENKINS_ADMIN_PASSWORD }),
    applySecret('jenkins', 'jenkins-secrets', {
        'webhook-secret': process.env.GITHUB_WEBHOOK_SECRET,
        'trigger-token': process.env.JENKINS_TRIGGER_TOKEN,
        // A fine-grained token for this repository's deployments. Every deploy build
        // first asks GitHub which deployment is the newest; without a token that
        // comes out of the anonymous allowance this network shares (B-026). With
        // it Jenkins also reports each outcome back to GitHub.
        'github-token': process.env.JENKINS_GITHUB_TOKEN ?? '',
    }),
].some((result) => result.stdout.includes('configured'));
// Read as environment variables, so a change needs a new relay pod (step 8).
const relaySecretChanged = applySecret('jenkins', 'webhook-relay', { 'smee-url': process.env.SMEE_URL, 'trigger-token': process.env.JENKINS_TRIGGER_TOKEN })
    .stdout.includes('configured');
console.log('    jenkins-admin, jenkins-secrets, webhook-relay: '
    + (process.env.JENKINS_GITHUB_TOKEN
        ? 'Jenkins reads GitHub with a token and reports each deployment back'
        : 'NO JENKINS_GITHUB_TOKEN in .env: deploys depend on GitHub\'s shared anonymous allowance and report nothing (B-026)'));

// ── 5. platform charts ────────────────────────────────────────────────────
heading('Platform charts (pinned in helm/platform/charts.json)');
const { charts } = JSON.parse(readFileSync(join(root, 'helm/platform/charts.json'), 'utf8'));
const repos = [...new Set(charts.map((chart) => chart.chart.split('/')[0]))];
for (const chart of charts) {
    run('helm', ['repo', 'add', chart.chart.split('/')[0], chart.repo], { capture: true, allowFailure: true });
}
// Only the repositories used here: updating every index on the machine is slow.
run('helm', ['repo', 'update', ...repos], { capture: true });
for (const chart of charts) {
    console.log('    ' + chart.release + ' ' + chart.version + ' -> ' + chart.namespace);
    run('helm', [
        '--kube-context', CONTEXT,
        'upgrade', '--install', chart.release, chart.chart,
        '--version', chart.version,
        '--namespace', chart.namespace, '--create-namespace',
        '--values', chart.values,
        '--wait', '--timeout', chart.timeout ?? '6m',
    ], { capture: true });
}
if (jenkinsSecretsChanged) {
    // A new admin password or webhook secret reaches Jenkins only when it starts.
    console.log('    Jenkins credentials changed: restarting Jenkins to read them');
    kubectl(['-n', 'jenkins', 'rollout', 'restart', 'statefulset/jenkins'], { capture: true });
    kubectl(['-n', 'jenkins', 'rollout', 'status', 'statefulset/jenkins', '--timeout=600s']);
}

// ── 6. image ──────────────────────────────────────────────────────────────
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

// ── 7. secret ─────────────────────────────────────────────────────────────
heading('Secret splitx-secrets (built from .env)');
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

// ── 8. manifests ──────────────────────────────────────────────────────────
heading('Applying ' + OVERLAY);
// A Job's pod template is immutable, so a changed schema.sql would make apply
// fail. The Job is disposable, and deleting it is how it gets updated.
kubectl(['delete', 'job', 'splitx-schema-init', '-n', NAMESPACE, '--ignore-not-found'], { capture: true });
kubectl(['apply', '-k', OVERLAY]);
// The Grafana dashboards (monitoring/kustomization.yaml).
kubectl(['apply', '-k', 'monitoring']);
// What the cluster refuses: an image from our registry that the release
// workflow did not sign (policy/verify-release.yaml, D-060).
kubectl(['apply', '-k', 'policy']);
// Jenkins' permissions, network policy, webhook relay and alerts (jenkins/kustomization.yaml).
kubectl(['apply', '-k', 'jenkins']);
if (relaySecretChanged) kubectl(['-n', 'jenkins', 'rollout', 'restart', 'deployment/webhook-relay'], { capture: true });

heading('Waiting for the database, the schema and the app');
kubectl(['-n', NAMESPACE, 'rollout', 'status', 'statefulset/splitx-postgres', '--timeout=240s']);
kubectl(['-n', NAMESPACE, 'rollout', 'status', 'deployment/splitx-redis', '--timeout=120s']);
kubectl(['-n', NAMESPACE, 'wait', '--for=condition=complete', 'job/splitx-schema-init', '--timeout=240s']);
kubectl(['-n', NAMESPACE, 'rollout', 'status', 'deployment/splitx', '--timeout=300s']);

heading('Are the pods running the image just loaded?');
// The local overlay deploys a tag, splitx:local, and a new build is loaded under
// that same tag. Nothing in the Deployment changes, so Kubernetes has no reason
// to replace a pod, and the old build keeps serving while this script reports
// success. It happened: a fix was "deployed" and measured without running.
// The node's containerd and the pods use the same image-ID scheme, so compare
// those and roll the deployment when they differ.
const nodeImage = run('docker', ['exec', CLUSTER + '-worker', 'crictl', 'inspecti', '-o', 'json', 'docker.io/library/' + IMAGE], { capture: true, allowFailure: true });
const loadedId = nodeImage.code === 0 ? JSON.parse(nodeImage.stdout).status?.id : null;
const runningIds = [...new Set(JSON.parse(kubectl(['-n', NAMESPACE, 'get', 'pods', '-l', 'app.kubernetes.io/name=splitx', '-o', 'json'], { capture: true }).stdout).items
    .filter((pod) => !pod.metadata.deletionTimestamp)
    .map((pod) => pod.status.containerStatuses?.[0]?.imageID))];
if (!loadedId) {
    console.log('    could not read the loaded image ID from the node; restarting to be sure');
}
if (!loadedId || runningIds.some((id) => id !== loadedId)) {
    console.log('    pods run ' + runningIds.map((id) => String(id).slice(7, 19)).join(', ') + ', the node has ' + String(loadedId).slice(7, 19) + ': rolling the deployment');
    kubectl(['-n', NAMESPACE, 'rollout', 'restart', 'deployment/splitx'], { capture: true });
    kubectl(['-n', NAMESPACE, 'rollout', 'status', 'deployment/splitx', '--timeout=300s']);
} else {
    console.log('    yes: ' + loadedId.slice(7, 19));
}

heading('Can the pods open new connections?');
// Readiness can pass on connections a pod opened before something broke, so it
// cannot answer this. When Kind's network-policy engine falls behind, every new
// pod connection times out while old ones keep working (D-044, D-050).
// Restarting kindnet clears its backlog; step 3 keeps it from building again.
const capture = (argv) => kubectl(argv, { capture: true, allowFailure: true });
let network = checkNewConnections(capture);
if (!network.every((result) => result.ok)) {
    console.log(describe(network));
    console.log('    new connections are being dropped; restarting kindnet');
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
