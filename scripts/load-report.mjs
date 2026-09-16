#!/usr/bin/env node
/**
 * Renders docs/evidence/load-tests.md from the raw results scripts/load-run.mjs
 * writes to docs/evidence/load/. The JSON files are the evidence; this page is
 * a view of them, regenerated after every run, so a number in it can always be
 * traced to the run that produced it.
 *
 *   node scripts/load-report.mjs
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pct = (part, whole) => (whole ? Math.round((part / whole) * 1000) / 10 + '%' : '-');
const ms = (value) => (value === null || value === undefined ? '-' : Math.round(value) + ' ms');
const n = (value) => (value === null || value === undefined ? '-' : value.toLocaleString('en-US'));

function load(root) {
    const dir = join(root, 'docs', 'evidence', 'load');
    let files = [];
    try {
        files = readdirSync(dir).filter((file) => file.endsWith('.json')).sort();
    } catch {
        return [];
    }
    return files.map((file) => ({ file, ...JSON.parse(readFileSync(join(dir, file), 'utf8')) }));
}

function classroom(runs) {
    if (!runs.length) return [];
    return [
        '## Classroom: 80 devices behind one address, production limits',
        '',
        'Students arrive over 30 seconds and plan a trip every 4 to 8 seconds; one extra',
        'device plans as fast as it can. All of it comes from one network address, the way',
        'a class on campus Wi-Fi reaches the internet through one NAT. ([load/classroom.js](../../load/classroom.js))',
        '',
        '| Run | Build | Student plans served | Students refused (429) | Greedy device served | Greedy refused (429) | Student p95 |',
        '|---|---|---|---|---|---|---|',
        ...runs.map((run) => {
            const s = run.requests.byGroup.student ?? {};
            const g = run.requests.byGroup.greedy ?? {};
            return '| [' + run.label + '](load/' + run.file + ') | `' + run.image.gitSha + '` | ' + n(s.ok) + ' of ' + n(s.requests)
                + ' | ' + n(s.limited) + ' (' + pct(s.limited, s.requests) + ') | ' + n(g.ok) + ' of ' + n(g.requests)
                + ' | ' + n(g.limited) + ' (' + pct(g.limited, g.requests) + ') | ' + ms(s.p95) + ' |';
        }),
        '',
    ];
}

function saturation(runs) {
    if (!runs.length) return [];
    return [
        '## Saturation: more work than two pods can do',
        '',
        'The deployment is pinned at two pods and sent 2,000-person plans faster than two cores',
        'can compute them, with rate limits lifted. What matters is what happens to the requests',
        'that are served once the backlog builds. ([load/saturation.js](../../load/saturation.js))',
        '',
        '| Run | Build | Arrival rate | Served | Shed (503) | Other | Served p50 | p95 | p99 | max | Queue clock |',
        '|---|---|---|---|---|---|---|---|---|---|---|',
        ...runs.map((run) => {
            const all = run.requests.byGroup.all ?? {};
            const clock = run.settings.config.TRUST_UPSTREAM_REQUEST_START === 'true' ? 'ingress-nginx' : 'app proxy';
            return '| [' + run.label + '](load/' + run.file + ') | `' + run.image.gitSha + '` | ' + (run.settings.k6?.rate ?? '-') + '/s | '
                + n(all.ok) + ' | ' + n(all.shed) + ' (' + pct(all.shed, all.requests) + ') | ' + n(all.other) + ' | '
                + ms(all.p50) + ' | ' + ms(all.p95) + ' | ' + ms(all.p99) + ' | ' + ms(all.max) + ' | ' + clock + ' |';
        }),
        '',
    ];
}

function staircaseRun(run) {
    const ROW = 30;
    const ends = [...run.cluster.map((sample) => sample.t), ...run.requests.timeline.map((bucket) => bucket.t)];
    const lastT = Math.max(...ends);
    const rows = [];
    for (let start = 0; start <= lastT; start += ROW) {
        const buckets = run.requests.timeline.filter((bucket) => bucket.t >= start && bucket.t < start + ROW);
        const samples = run.cluster.filter((sample) => sample.t >= start && sample.t < start + ROW && sample.error === undefined);
        const last = samples.at(-1);
        if (!buckets.length && !last) continue;
        const requests = buckets.reduce((sum, bucket) => sum + bucket.requests, 0);
        const p95s = buckets.map((bucket) => bucket.p95).filter((value) => value !== null);
        rows.push({
            start,
            rate: Math.round((requests / ROW) * 10) / 10,
            p95: p95s.length ? Math.max(...p95s) : null,
            shed: buckets.reduce((sum, bucket) => sum + bucket.shed, 0),
            ready: last?.ready ?? null,
            desired: last?.desired ?? null,
            cpu: last?.cpu ?? null,
        });
    }

    const minutes = (seconds) => String(Math.round((seconds / 60) * 10) / 10);
    const min = run.settings.autoscaler.min;
    const peak = Math.max(...run.cluster.map((sample) => sample.ready ?? 0));
    const firstPeak = run.cluster.find((sample) => sample.ready === peak);
    const firstScaleUp = run.cluster.find((sample) => (sample.ready ?? 0) > min);
    const backToMin = run.cluster.find((sample) => sample.t > run.loadSeconds && sample.ready === min && sample.replicas === min);
    const all = run.requests.byGroup.all ?? {};
    const scaleTop = Math.max(12, Math.ceil(Math.max(...rows.map((row) => row.rate / 10))) + 1);

    return [
        '### ' + run.label + ' (build `' + run.image.gitSha + '`)',
        '',
        '| | |',
        '|---|---|',
        '| Requests | ' + n(all.requests) + ' over ' + run.loadSeconds + ' s: ' + n(all.ok) + ' served, ' + n(all.shed) + ' shed, ' + n(all.limited) + ' rate limited, ' + n(all.other) + ' other |',
        '| Served latency | p50 ' + ms(all.p50) + ', p95 ' + ms(all.p95) + ', p99 ' + ms(all.p99) + ' |',
        '| Autoscaler | ' + min + ' to ' + run.settings.autoscaler.max + ' pods, CPU target ' + run.settings.autoscaler.cpuTarget + '% of the request |',
        '| First scale-up | ' + (firstScaleUp ? firstScaleUp.t + ' s after the load started' : 'never') + ' |',
        '| Peak | ' + peak + ' ready pods' + (firstPeak ? ', first reached at ' + firstPeak.t + ' s' : '') + ' |',
        '| Back to ' + min + ' pods | ' + (backToMin ? Math.round(backToMin.t - run.loadSeconds) + ' s after the load stopped' : 'not within the ' + run.observeSeconds + ' s watched') + ' |',
        '',
        '```mermaid',
        'xychart-beta',
        '  title "Ready pods (line) and requests per second / 10 (bars), every 30 s"',
        '  x-axis "minutes" [' + rows.map((row) => minutes(row.start)).join(', ') + ']',
        '  y-axis "pods" 0 --> ' + scaleTop,
        '  bar [' + rows.map((row) => Math.round(row.rate) / 10).join(', ') + ']',
        '  line [' + rows.map((row) => row.ready ?? 0).join(', ') + ']',
        '```',
        '',
        '| Elapsed | Requests/s | Worst 10 s p95 | Shed | Ready pods | Autoscaler wants | CPU vs request |',
        '|---|---|---|---|---|---|---|',
        ...rows.map((row) => '| ' + minutes(row.start) + ' min | ' + row.rate + ' | ' + ms(row.p95) + ' | ' + row.shed + ' | ' + (row.ready ?? '-') + ' | ' + (row.desired ?? '-') + ' | ' + (row.cpu === null ? '-' : row.cpu + '%') + ' |'),
        '',
    ];
}

function staircase(runs) {
    if (!runs.length) return [];
    return [
        '## Staircase: the autoscaler under rising load',
        '',
        '1,000-person plans at 10, 30, 60 and 100 requests a second, two minutes each, then',
        'nothing, with the cluster watched until it scales back down. Rate limits lifted.',
        '([load/staircase.js](../../load/staircase.js))',
        '',
        ...runs.flatMap(staircaseRun),
    ];
}

export function writeReport(root) {
    const results = load(root);
    const of = (test) => results.filter((run) => run.test === test);
    const lines = [
        '# Load tests: what real traffic did to the cluster',
        '',
        'Generated by `scripts/load-report.mjs` from the raw results in [`docs/evidence/load/`](load/).',
        'Every run: k6 2.2.0 in its official container on the same machine as the Kind cluster,',
        'through ingress-nginx, from a single network address. Cluster state was sampled every',
        '5 s, and can lead the request timeline by the 1 to 3 s k6 takes to start.',
        '',
        ...classroom(of('classroom')),
        ...saturation(of('saturation')),
        ...staircase(of('staircase')),
    ];
    writeFileSync(join(root, 'docs', 'evidence', 'load-tests.md'), lines.join('\n') + '\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    writeReport(join(dirname(fileURLToPath(import.meta.url)), '..'));
    console.log('wrote docs/evidence/load-tests.md');
}
