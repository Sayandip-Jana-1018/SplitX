#!/usr/bin/env node
/**
 * Runs one k6 load test against the local cluster and records, side by side,
 * what happened to the requests and what the cluster did about it.
 *
 *   node scripts/load-run.mjs classroom  --label before
 *   node scripts/load-run.mjs saturation --label before
 *   node scripts/load-run.mjs staircase  --label v1 [--observe 900]
 *   ... [--env KEY=VALUE]    passed to k6 (e.g. HOLD=30s, RATE=80)
 *
 * Each test declares the overlay it needs (production limits for the
 * classroom, lifted limits for the others, two fixed pods for saturation).
 * The runner applies it, waits for the deployment to be at rest and able to
 * open new connections, runs k6 in its official container, keeps watching the
 * cluster after the load stops, puts the local overlay back, and writes
 * docs/evidence/load/<test>-<label>.json. scripts/load-report.mjs turns every
 * result into docs/evidence/load-tests.md.
 *
 * Time: k6 runs inside the Docker VM, whose clock can differ from Windows by
 * most of a minute after the laptop sleeps (D-044). Both series are therefore
 * aligned by elapsed time since k6 started, never by wall-clock time.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { createGunzip } from 'node:zlib';
import { checkNewConnections, describe } from './lib/cluster-network.mjs';
import { writeReport } from './load-report.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONTEXT = 'kind-splitx';
const NS = 'splitx';
const K6_IMAGE = 'grafana/k6:2.2.0@sha256:9bd01d6941fca969cb61bb57d2da5ee9b385fe2aa8881df3798c196564d6ace6';
const BUCKET_SECONDS = 10;
const POLL_MS = 5_000;
// Docker wants forward slashes in -v paths on Windows.
const BACKSLASH = String.fromCharCode(92);

const TESTS = {
    classroom: { script: 'classroom.js', overlay: 'k8s/overlays/local', observe: 20 },
    saturation: { script: 'saturation.js', overlay: 'k8s/overlays/saturation', observe: 20 },
    staircase: { script: 'staircase.js', overlay: 'k8s/overlays/loadtest', observe: 900 },
};

const args = process.argv.slice(2);
const testName = args[0];
const test = TESTS[testName];
if (!test) {
    console.error('usage: node scripts/load-run.mjs <' + Object.keys(TESTS).join('|') + '> --label <name> [--observe seconds] [--env KEY=VALUE]');
    process.exit(1);
}
const option = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
};
const label = option('--label') || 'run';
const observeSeconds = Number(option('--observe') ?? test.observe);
const k6Env = args.flatMap((arg, i) => (arg === '--env' && args[i + 1] ? [args[i + 1]] : []));

function kubectl(argv, { allowFailure = true } = {}) {
    const result = spawnSync('kubectl', ['--context', CONTEXT, ...argv], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (result.status !== 0 && !allowFailure) {
        console.error(result.stderr);
        throw new Error('kubectl ' + argv.slice(0, 3).join(' ') + ' failed');
    }
    return { code: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}
const getJson = (argv) => JSON.parse(kubectl([...argv, '-o', 'json']).stdout || '{}');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function applyOverlay(overlay) {
    console.log('applying ' + overlay);
    kubectl(['apply', '-k', overlay], { allowFailure: false });
    kubectl(['-n', NS, 'rollout', 'status', 'deployment/splitx', '--timeout=300s'], { allowFailure: false });
    // A finished rollout still leaves old pods serving through their preStop
    // delay while ingress-nginx catches up. Measuring straight away would send
    // the first requests to pods running the previous configuration.
    await sleep(15_000);
}

/** The deployment at its HPA minimum, every replica ready — so tests start from the same place. */
async function waitForRest(timeoutMs = 20 * 60_000) {
    const deadline = Date.now() + timeoutMs;
    let lastReport = 0;
    while (Date.now() < deadline) {
        const hpa = getJson(['-n', NS, 'get', 'hpa', 'splitx']);
        const deployment = getJson(['-n', NS, 'get', 'deployment', 'splitx']);
        const min = hpa.spec?.minReplicas;
        const replicas = deployment.spec?.replicas;
        const ready = deployment.status?.readyReplicas ?? 0;
        if (replicas === min && ready === min && (deployment.status?.updatedReplicas ?? 0) === min) return { replicas, ready };
        if (Date.now() - lastReport > 30_000) {
            console.log('  waiting for rest: ' + ready + ' ready of ' + replicas + ', autoscaler minimum ' + min);
            lastReport = Date.now();
        }
        await sleep(5_000);
    }
    throw new Error('the deployment did not come to rest within ' + timeoutMs / 60_000 + ' minutes');
}

/** One snapshot of what the autoscaler and the deployment are doing. */
function sampleCluster(startedAt) {
    const hpa = getJson(['-n', NS, 'get', 'hpa', 'splitx']);
    const deployment = getJson(['-n', NS, 'get', 'deployment', 'splitx']);
    const pods = getJson(['-n', NS, 'get', 'pods', '-l', 'app.kubernetes.io/name=splitx']).items ?? [];
    const running = pods.filter((pod) => !pod.metadata.deletionTimestamp);
    const perNode = {};
    for (const pod of running) perNode[pod.spec.nodeName ?? 'pending'] = (perNode[pod.spec.nodeName ?? 'pending'] ?? 0) + 1;
    return {
        t: Math.round((Date.now() - startedAt) / 100) / 10,
        desired: hpa.status?.desiredReplicas ?? null,
        current: hpa.status?.currentReplicas ?? null,
        cpu: hpa.status?.currentMetrics?.[0]?.resource?.current?.averageUtilization ?? null,
        replicas: deployment.spec?.replicas ?? null,
        ready: deployment.status?.readyReplicas ?? 0,
        pods: running.length,
        pending: running.filter((pod) => pod.status.phase === 'Pending').length,
        restarts: running.reduce((sum, pod) => sum + (pod.status.containerStatuses?.[0]?.restartCount ?? 0), 0),
        perNode,
    };
}

function runK6(outDir) {
    return new Promise((resolve) => {
        const argv = [
            'run', '--rm',
            '-v', join(root, 'load').split(BACKSLASH).join('/') + ':/scripts:ro',
            '-v', outDir.split(BACKSLASH).join('/') + ':/out',
            ...k6Env.flatMap((pair) => ['-e', pair]),
            K6_IMAGE,
            'run', '--quiet', '--out', 'csv=/out/samples.csv.gz', '/scripts/' + test.script,
        ];
        const child = spawn('docker', argv, { cwd: root, stdio: ['ignore', 'inherit', 'inherit'] });
        child.on('close', (code) => resolve(code));
    });
}

const percentile = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : null);
const round = (value) => (value === null ? null : Math.round(value * 10) / 10);

/** Reads k6's per-request samples into time buckets and per-group totals. */
async function analyse(csvPath) {
    const lines = createInterface({ input: createReadStream(csvPath).pipe(createGunzip()), crlfDelay: Infinity });
    let columns = null;
    let firstTimestamp = null;
    const buckets = new Map();
    const groups = new Map();
    const blank = () => ({ requests: 0, ok: 0, limited: 0, shed: 0, other: 0, statuses: {}, durations: [] });

    for await (const line of lines) {
        if (!columns) {
            columns = Object.fromEntries(line.split(',').map((name, index) => [name, index]));
            continue;
        }
        const cells = line.split(',');
        const requestName = cells[columns.name];
        if (cells[columns.metric_name] !== 'http_req_duration' || (requestName !== 'preview' && requestName !== 'live')) continue;

        const timestamp = Number(cells[columns.timestamp]);
        if (firstTimestamp === null || timestamp < firstTimestamp) firstTimestamp = firstTimestamp === null ? timestamp : Math.min(firstTimestamp, timestamp);
        const status = Number(cells[columns.status]);
        const duration = Number(cells[columns.metric_value]);
        const tags = new URLSearchParams(cells[columns.extra_tags] ?? '');
        const who = requestName === 'live' ? 'liveness' : tags.get('who') ?? 'all';
        // Liveness checks are measured on their own and kept out of the request timeline.
        const targets = requestName === 'live' ? [[groups, who]] : [[buckets, timestamp], [groups, who]];

        for (const [map, key] of targets) {
            if (!map.has(key)) map.set(key, blank());
            const entry = map.get(key);
            entry.requests += 1;
            entry.statuses[status] = (entry.statuses[status] ?? 0) + 1;
            if (status === 200) {
                entry.ok += 1;
                entry.durations.push(duration);
            } else if (status === 429) entry.limited += 1;
            else if (status === 503) entry.shed += 1;
            else entry.other += 1;
        }
    }

    const summarise = (entry) => {
        const sorted = entry.durations.sort((a, b) => a - b);
        const counts = { requests: entry.requests, ok: entry.ok, limited: entry.limited, shed: entry.shed, other: entry.other, statuses: entry.statuses };
        return { ...counts, p50: round(percentile(sorted, 50)), p95: round(percentile(sorted, 95)), p99: round(percentile(sorted, 99)), max: round(sorted.at(-1) ?? null) };
    };

    // Per-second samples folded into fixed buckets of elapsed time.
    const folded = new Map();
    for (const [timestamp, entry] of buckets) {
        const t = Math.floor((timestamp - firstTimestamp) / BUCKET_SECONDS) * BUCKET_SECONDS;
        if (!folded.has(t)) folded.set(t, blank());
        const target = folded.get(t);
        for (const key of ['requests', 'ok', 'limited', 'shed', 'other']) target[key] += entry[key];
        for (const [code, count] of Object.entries(entry.statuses)) target.statuses[code] = (target.statuses[code] ?? 0) + count;
        for (const d of entry.durations) target.durations.push(d);
    }
    return {
        bucketSeconds: BUCKET_SECONDS,
        timeline: [...folded.entries()].sort((a, b) => a[0] - b[0]).map(([t, entry]) => ({ t, ...summarise(entry), rate: round(entry.requests / BUCKET_SECONDS) })),
        byGroup: Object.fromEntries([...groups.entries()].map(([who, entry]) => [who, summarise(entry)])),
    };
}

// ── run ───────────────────────────────────────────────────────────────────
console.log('SplitX load test: ' + testName + ' (' + label + ')');
await applyOverlay(test.overlay);
const rest = await waitForRest();
console.log('at rest: ' + rest.ready + ' ready replicas');

const network = checkNewConnections((argv) => kubectl(argv));
if (!network.every((result) => result.ok)) {
    console.error(describe(network));
    console.error('pods cannot open new connections; run npm run k8s:up first (D-044)');
    process.exit(1);
}

const deployment = getJson(['-n', NS, 'get', 'deployment', 'splitx']);
const configName = deployment.spec.template.spec.containers[0].envFrom.find((source) => source.configMapRef)?.configMapRef.name;
const config = getJson(['-n', NS, 'get', 'configmap', configName]).data ?? {};
const hpaSpec = getJson(['-n', NS, 'get', 'hpa', 'splitx']).spec;
const firstPod = getJson(['-n', NS, 'get', 'pods', '-l', 'app.kubernetes.io/name=splitx']).items[0].metadata.name;
const [gitSha, version] = kubectl(['-n', NS, 'exec', firstPod, '--', 'printenv', 'GIT_SHA', 'APP_VERSION']).stdout.trim().split(/\s+/);

const outDir = join(tmpdir(), 'splitx-load-' + testName + '-' + Date.now());
mkdirSync(outDir, { recursive: true });

const samples = [];
let polling = true;
const startedAt = Date.now();
const poller = (async () => {
    while (polling) {
        try {
            samples.push(sampleCluster(startedAt));
        } catch (error) {
            samples.push({ t: (Date.now() - startedAt) / 1000, error: String(error) });
        }
        await sleep(POLL_MS);
    }
})();

const exitCode = await runK6(outDir);
const loadSeconds = Math.round((Date.now() - startedAt) / 1000);
console.log('k6 finished (exit ' + exitCode + ') after ' + loadSeconds + ' s; watching the cluster for ' + observeSeconds + ' s more');
for (let waited = 0; waited < observeSeconds; waited += 60) {
    await sleep(Math.min(60, observeSeconds - waited) * 1000);
    const last = samples.at(-1);
    if (last && observeSeconds > 60) console.log('  +' + Math.min(observeSeconds, waited + 60) + ' s: ' + last.ready + ' ready, autoscaler wants ' + last.desired);
}
polling = false;
await poller;

if (test.overlay !== 'k8s/overlays/local') await applyOverlay('k8s/overlays/local');

const csvPath = join(outDir, 'samples.csv.gz');
if (!existsSync(csvPath)) {
    console.error('k6 wrote no samples; nothing to record');
    process.exit(1);
}
const requests = await analyse(csvPath);
const summary = JSON.parse(readFileSync(join(outDir, 'summary.json'), 'utf8'));

const result = {
    test: testName,
    label,
    ranAt: new Date().toISOString(),
    k6ExitCode: exitCode,
    image: { gitSha, version },
    overlay: test.overlay,
    settings: {
        k6Env,
        k6: summary.extra,
        autoscaler: { min: hpaSpec.minReplicas, max: hpaSpec.maxReplicas, cpuTarget: hpaSpec.metrics?.[0]?.resource?.target?.averageUtilization, behavior: hpaSpec.behavior },
        config: Object.fromEntries(Object.entries(config).filter(([key]) => /RATE_LIMIT|QUEUE|REQUEST_START|PROXY_HOPS/.test(key))),
    },
    loadSeconds,
    observeSeconds,
    requests,
    cluster: samples,
};

const evidenceDir = join(root, 'docs', 'evidence', 'load');
mkdirSync(evidenceDir, { recursive: true });
const resultPath = join(evidenceDir, testName + '-' + label + '.json');
writeFileSync(resultPath, JSON.stringify(result, null, 2) + '\n');
rmSync(outDir, { recursive: true, force: true });

const all = requests.byGroup;
for (const [group, totals] of Object.entries(all)) {
    console.log('  ' + group + ': ' + totals.requests + ' requests, statuses ' + JSON.stringify(totals.statuses) + '; served p50 ' + totals.p50 + ' ms, p95 ' + totals.p95 + ' ms');
}
console.log('peak replicas: ' + Math.max(...samples.map((s) => s.ready ?? 0)) + '; container restarts during the test: ' + (Math.max(...samples.map((s) => s.restarts ?? 0)) - (samples[0]?.restarts ?? 0)));
console.log('wrote ' + resultPath);
writeReport(root);
console.log('updated docs/evidence/load-tests.md');
