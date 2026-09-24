#!/usr/bin/env node
/**
 * Proves the control room works on a running cluster, through the app the
 * way an operator uses it, and writes what it measured to docs/evidence/ops.md
 * (kind-e2e.yml, D-099).
 *
 *   node scripts/ops-verify.mjs [--delivered <sha> --deployment <id>]
 *
 *   1. Who may read it: signed out 401, a signed-in visitor 403, an operator 200.
 *   2. ops-api's readings, as /api/ops/cluster hands them to the page: each
 *      one the source's data, or unavailable with its reason (on Kind, the
 *      four AWS ones: there is no AWS role).
 *   3. The traffic lab, started from /api/ops/traffic like the page's Start
 *      button: its run, what it served, and whether the autoscaler asked for
 *      more pods while it ran.
 *   4. With --delivered: the release Jenkins just deployed has its evidence
 *      in Nexus, complete, and Jenkins' metrics show the deploy.
 *
 * The operator and the visitor exist only in the cluster's own database, made
 * here for the check; OPS_ADMINS names the operator (scripts/lib/e2e.mjs).
 * Their sessions are signed with the run's NEXTAUTH_SECRET, as the app signs
 * one at sign-in. Nothing printed is a secret.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JENKINS_RESULTS } from '../ops/api/summaries.mjs';
import { E2E_OPERATOR, E2E_VISITOR, e2eSessionCookie, READINGS_ON_AWS_ONLY, READINGS_ON_KIND } from './lib/e2e.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
if (existsSync(join(root, '.env'))) process.loadEnvFile(join(root, '.env'));
const CONTEXT = 'kind-splitx';
const BASE = 'http://localhost';
const option = (name) => {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] ?? '' : '';
};
const delivered = option('--delivered');
const deploymentId = option('--deployment');

const checks = [];
let failures = 0;
function record(name, passed, detail) {
    checks.push({ name, passed, detail });
    if (!passed) failures += 1;
    console.log((passed ? '  PASS  ' : '  FAIL  ') + name + (detail ? ' — ' + detail : ''));
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const kubectl = (argv, input) => spawnSync('kubectl', ['--context', CONTEXT, ...argv], { encoding: 'utf8', input });

// ── the operator and the visitor ──────────────────────────────────────────
const quote = (text) => "'" + text.replaceAll("'", "''") + "'";
const seed = [E2E_OPERATOR, E2E_VISITOR].map((person) =>
    'INSERT INTO "User" (id, name, email, "tokenVersion", "updatedAt") VALUES ('
    + [person.userId, person.name, person.email].map(quote).join(', ') + ', 0, now()) ON CONFLICT (id) DO NOTHING;').join('\n')
    + '\nINSERT INTO "Account" (id, "userId", type, provider, "providerAccountId") VALUES ('
    + [E2E_OPERATOR.userId + '-' + E2E_OPERATOR.provider, E2E_OPERATOR.userId, 'oauth', E2E_OPERATOR.provider, E2E_OPERATOR.accountId].map(quote).join(', ')
    + ') ON CONFLICT DO NOTHING;\n';
const seeded = kubectl(['-n', 'splitx', 'exec', '-i', 'statefulset/splitx-postgres', '--', 'psql', '-U', 'splitx', '-d', 'splitx', '-v', 'ON_ERROR_STOP=1', '-q'], seed);
if (seeded.status !== 0) {
    console.error('x could not add the check\'s operator to the cluster\'s database: ' + seeded.stderr.trim());
    process.exit(1);
}

const projectRequire = createRequire(join(root, 'package.json'));
const { encode } = await import(pathToFileURL(projectRequire.resolve('next-auth/jwt')).href);
// The cluster runs a production build, whose cookie is __Secure- even over http.
const operator = await e2eSessionCookie(encode, E2E_OPERATOR, process.env.NEXTAUTH_SECRET);
const visitor = await e2eSessionCookie(encode, E2E_VISITOR, process.env.NEXTAUTH_SECRET);

async function api(path, { cookie, method = 'GET', body } = {}) {
    try {
        const response = await fetch(BASE + path, {
            method,
            headers: { ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
            body: body ? JSON.stringify(body) : undefined,
            redirect: 'manual',
            signal: AbortSignal.timeout(20_000),
        });
        return { status: response.status, json: await response.json().catch(() => null) };
    } catch (error) {
        return { status: 0, json: null, error: error.message };
    }
}

console.log('SplitX — the control room on a running cluster\n');

// ── 1. who may read it ────────────────────────────────────────────────────
console.log('[1] Who may read it');
const [anonymous, stranger, allowed] = await Promise.all([
    api('/api/ops/cluster'),
    api('/api/ops/cluster', { cookie: visitor }),
    api('/api/ops/cluster', { cookie: operator }),
]);
record(
    'Only an operator reads the cluster through the app',
    anonymous.status === 401 && stranger.status === 403 && allowed.status === 200,
    'signed out: HTTP ' + anonymous.status + '; a signed-in visitor: HTTP ' + stranger.status + '; the operator: HTTP ' + allowed.status
);

// ── 2. the readings ───────────────────────────────────────────────────────
console.log('\n[2] What ops-api reads, as the page gets it');
const ON_KIND = READINGS_ON_KIND;
const AWS_ONLY = READINGS_ON_AWS_ONLY;
const cluster = allowed.json?.cluster;
const readings = cluster?.ok ? cluster.data : {};
record('ops-api answered the app', Boolean(cluster?.ok), cluster?.ok ? cluster.source + ', read ' + cluster.fetchedAt : 'unavailable: ' + (cluster?.error ?? 'no reading'));
for (const key of ON_KIND) {
    const reading = readings[key];
    record('The ' + key + ' reading has its source\'s data', reading?.ok === true, reading?.ok ? reading.source : 'unavailable: ' + (reading?.error ?? 'missing'));
}
const awsReasons = AWS_ONLY.map((key) => readings[key]);
record(
    'The AWS readings say why they are unavailable here, rather than showing anything',
    awsReasons.every((reading) => reading?.ok === false && /no AWS role here/.test(reading.error)),
    awsReasons.map((reading, index) => AWS_ONLY[index] + ': ' + (reading?.ok ? 'data?' : reading?.error ?? 'missing')).join('; ').slice(0, 300)
);
const nodes = readings.nodes?.ok ? readings.nodes.data : [];
const admissions = readings.admissions?.ok ? readings.admissions.data : null;
record(
    'Kyverno\'s admission counts reach the page (its metrics, scraped by Prometheus)',
    Boolean(admissions) && admissions.allowed > 0,
    admissions ? admissions.allowed + ' allowed and ' + admissions.refused + ' refused in the last 24 hours' : 'no reading'
);

// ── 3. the traffic lab ────────────────────────────────────────────────────
console.log('\n[3] The traffic lab, started from the page\'s API');
const RATE = 30;
const SECONDS = 180;
const before = readings.autoscaler?.ok ? readings.autoscaler.data : null;
const started = await api('/api/ops/traffic', { cookie: operator, method: 'POST', body: { rate: RATE, seconds: SECONDS } });
// The lab answers 202: the run has started, and its result comes later.
record('The lab accepted a run of ' + RATE + ' plans a second for ' + SECONDS + ' s', started.status === 202, 'HTTP ' + started.status + (started.json?.error ? ': ' + started.json.error : ''));
const again = await api('/api/ops/traffic', { cookie: operator, method: 'POST', body: { rate: RATE, seconds: SECONDS } });
record('A second run is refused while one is going', again.status === 409, 'HTTP ' + again.status);
const refusedByLimits = await api('/api/ops/traffic', { cookie: operator, method: 'POST', body: { rate: 31, seconds: 60 } });
record('The app refuses a rate above the lab\'s cap', refusedByLimits.status === 400, 'rate 31: HTTP ' + refusedByLimits.status);

const timeline = [];
let run = null;
let peakDesired = before?.desired ?? 0;
let peakServing = 0;
let peakRate = 0;
const deadline = Date.now() + (SECONDS + 120) * 1000;
while (Date.now() < deadline) {
    await sleep(5_000);
    const now = (await api('/api/ops/cluster', { cookie: operator })).json?.cluster;
    if (!now?.ok) continue;
    const { lab, autoscaler, servingPods, traffic } = now.data;
    run = lab.ok ? lab.data : run;
    const desired = autoscaler.ok ? autoscaler.data.desired ?? 0 : 0;
    const current = autoscaler.ok ? autoscaler.data.current ?? 0 : 0;
    const serving = servingPods.ok ? servingPods.data.length : 0;
    const points = traffic.ok ? traffic.data.charts.requests.points.filter(([, value]) => value !== null) : [];
    const rate = points.length ? points.at(-1)[1] : 0;
    peakDesired = Math.max(peakDesired, desired);
    peakServing = Math.max(peakServing, serving);
    peakRate = Math.max(peakRate, rate);
    timeline.push({ at: new Date().toISOString().slice(11, 19), state: run?.state ?? '?', elapsed: run?.elapsedSeconds ?? 0, current, desired, serving, rate: Math.round(rate * 10) / 10 });
    console.log('    ' + timeline.at(-1).at + '  lab ' + (run?.state ?? '?') + ' ' + (run?.elapsedSeconds ?? 0) + ' s  pods ' + current + ' (wanted ' + desired + ')  answering ' + serving + '  ' + timeline.at(-1).rate + ' req/s');
    if (run && !['running', 'stopping'].includes(run.state) && timeline.length > 2) break;
}
const summary = run?.summary;
record(
    'The run finished, and what it sent was served or refused on purpose',
    run?.state === 'finished' && Boolean(summary) && summary.served > 0 && summary.failed <= summary.requests * 0.01,
    summary
        ? summary.requests + ' requests: ' + summary.served + ' served, ' + summary.refused + ' refused on purpose (rate limits, load shedding), ' + summary.failed + ' failed; p95 ' + summary.p95Ms + ' ms'
        : 'the lab ended ' + (run?.state ?? 'without a state') + (run?.error ? ': ' + run.error : '')
);
record(
    'The autoscaler asked for more pods while the lab ran',
    before !== null && peakDesired > (before.desired ?? 0),
    'wanted ' + (before?.desired ?? '?') + ' before, at most ' + peakDesired + ' during the run (between ' + (before?.min ?? '?') + ' and ' + (before?.max ?? '?') + '); up to ' + peakServing + ' pods answered at once'
);
record('Prometheus saw the load the lab sent', peakRate >= RATE / 3, 'peak ' + Math.round(peakRate * 10) / 10 + ' requests a second on the page\'s chart');

// ── 4. the delivery's evidence ────────────────────────────────────────────
if (delivered) {
    console.log('\n[4] The release Jenkins delivered');
    const last = (await api('/api/ops/cluster', { cookie: operator })).json?.cluster;
    const evidence = last?.ok && last.data.evidence.ok ? last.data.evidence.data : [];
    const entry = evidence.find((row) => row.commit === delivered.slice(0, 12) && (!deploymentId || row.deployment === deploymentId));
    record(
        'Its evidence is in Nexus, complete',
        Boolean(entry?.complete),
        entry ? entry.commit + '/' + entry.deployment + ': ' + entry.files.join(', ') : 'Nexus lists ' + (evidence.map((row) => row.commit + '/' + row.deployment).join(', ') || 'nothing')
    );
    // Jenkins publishes these only once it has built something. Its last build
    // is whichever ran last: after cd:verify --rollback, that is the release
    // made to fail on purpose, so any real result passes and the page shows it.
    const deliveryReading = last?.ok && last.data.delivery.ok ? last.data.delivery.data : null;
    record(
        'Jenkins\' own build metrics reach the page, through Prometheus',
        JENKINS_RESULTS.includes(deliveryReading?.lastResult ?? ''),
        deliveryReading ? 'its last build: ' + deliveryReading.lastResult + ', ' + deliveryReading.lastSeconds + ' s' : 'no reading'
    );
}

// ── the evidence ──────────────────────────────────────────────────────────
const table = (rows) => ['| Check | Result | Detail |', '|---|---|---|', ...rows.map((c) => '| ' + c.name + ' | ' + (c.passed ? 'pass' : '**FAIL**') + ' | ' + String(c.detail ?? '').replaceAll('|', '/') + ' |')].join('\n');
const report = [
    '# The control room on a running cluster',
    '',
    'Written by `scripts/ops-verify.mjs` on ' + new Date().toISOString().slice(0, 10) + (process.env.GITHUB_RUN_ID ? ', in kind-e2e run ' + process.env.GITHUB_RUN_ID : '') + '.',
    'Every line is an answer from the app, as an operator\'s browser gets it, and through it from ops-api and the traffic lab.',
    '',
    '## Result',
    '',
    table(checks),
    '',
    '## The traffic lab\'s run, every 5 seconds',
    '',
    '| Time (UTC) | Lab | Elapsed (s) | Pods | Wanted | Answering | Requests/s |',
    '|---|---|---|---|---|---|---|',
    ...timeline.map((row) => '| ' + [row.at, row.state, row.elapsed, row.current, row.desired, row.serving, row.rate].join(' | ') + ' |'),
    '',
    'The cluster had ' + nodes.length + ' nodes: ' + nodes.map((node) => node.name + ' (CPU ' + node.cpuPercent + ' %, memory ' + node.memoryPercent + ' %)').join(', ') + '.',
].join('\n');
writeFileSync(join(root, 'docs/evidence/ops.md'), report + '\n');
console.log('\n' + (failures ? failures + ' check(s) failed' : 'All ' + checks.length + ' checks passed') + '. Written to docs/evidence/ops.md');
process.exit(failures ? 1 : 0);
