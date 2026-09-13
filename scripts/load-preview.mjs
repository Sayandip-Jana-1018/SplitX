#!/usr/bin/env node
/**
 * Measures the settlement preview under load against ONE running instance:
 * throughput, latency, shed rate and the instance's own CPU use at each
 * concurrency step. CPU comes from the instance's
 * splitx_process_cpu_seconds_total, so it is what that process really spent.
 *
 *   node --env-file=.env scripts/load-preview.mjs [baseUrl] [--members 2000] [--steps 1,2,4,8] [--seconds 15]
 *   node --env-file=.env scripts/load-preview.mjs [baseUrl] --sizes 100,500,1000,2000
 *
 * --sizes measures CPU per request at each group size, one request at a time.
 *
 * Point it at a single process (a container, `kubectl port-forward pod/...`):
 * behind a Service, requests spread across pods and one pod's CPU won't add up.
 * The proxy rate limits the preview per identity, so raise
 * RATE_LIMIT_PREVIEW_PER_MINUTE on the instance first, or the run measures 429s.
 * Workers honour Retry-After on 429 and 503, like a well-behaved client.
 */

const args = process.argv.slice(2);
const option = (name, fallback) => {
    const index = args.indexOf(`--${name}`);
    return index === -1 ? fallback : args[index + 1];
};
const BASE_URL = (args.find((arg, i) => !arg.startsWith('--') && !args[i - 1]?.startsWith('--')) || 'http://127.0.0.1:3000').replace(/\/$/, '');
const TOKEN = process.env.METRICS_TOKEN;
const MEMBERS = Number(option('members', 2000));
const STEPS = option('steps', '1,2,4,8').split(',').map(Number);
const SECONDS = Number(option('seconds', 15));
const SIZES = option('sizes', null)?.split(',').map(Number);

let nextSeed = 1;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function cpuSeconds() {
    const res = await fetch(`${BASE_URL}/api/metrics`, { headers: TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {} });
    if (!res.ok) throw new Error(`scrape failed: HTTP ${res.status}`);
    const line = (await res.text()).split('\n').find((l) => l.startsWith('splitx_process_cpu_seconds_total '));
    if (!line) throw new Error('splitx_process_cpu_seconds_total not exported');
    return Number(line.split(' ')[1]);
}

async function preview(members) {
    const started = performance.now();
    const res = await fetch(`${BASE_URL}/api/settlements/preview`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scenario: { members, seed: nextSeed++ } }),
    });
    const body = await res.json().catch(() => null);
    return {
        status: res.status,
        latencyMs: performance.now() - started,
        computeMs: body?.data?.computeMs,
        retryAfter: Number(res.headers.get('retry-after')) || 0,
        servedBy: body?.data?.servedBy,
        summary: body?.data?.summary,
    };
}

const percentile = (values, p) => {
    if (values.length === 0) return NaN;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
};
const fixed = (value, digits = 1) => (Number.isFinite(value) ? value.toFixed(digits) : '—');

async function step(concurrency) {
    const results = [];
    const cpuBefore = await cpuSeconds();
    const startedAt = performance.now();
    const deadline = startedAt + SECONDS * 1000;

    await Promise.all(Array.from({ length: concurrency }, async () => {
        while (performance.now() < deadline) {
            const result = await preview(MEMBERS).catch((error) => ({ status: 0, error }));
            results.push(result);
            if (result.retryAfter) await sleep(result.retryAfter * 1000);
        }
    }));

    const elapsed = (performance.now() - startedAt) / 1000;
    const cpu = (await cpuSeconds()) - cpuBefore;
    const ok = results.filter((r) => r.status === 200);
    const count = (status) => results.filter((r) => r.status === status).length;
    return {
        concurrency,
        requests: results.length,
        ok: ok.length,
        rateLimited: count(429),
        shed: count(503),
        failed: results.filter((r) => ![200, 429, 503].includes(r.status)).length,
        throughput: ok.length / elapsed,
        p50: percentile(ok.map((r) => r.latencyMs), 50),
        p95: percentile(ok.map((r) => r.latencyMs), 95),
        p99: percentile(ok.map((r) => r.latencyMs), 99),
        computeP50: percentile(ok.map((r) => r.computeMs), 50),
        cores: cpu / elapsed,
        cpuMsPerOk: ok.length ? (cpu * 1000) / ok.length : NaN,
    };
}

async function sizes() {
    console.log(`\nCPU per request by group size — ${BASE_URL}, one request at a time\n`);
    console.log('| members | expenses | transfers (greedy → planned) | direct IOUs | compute p50 ms | server CPU ms / request |');
    console.log('|---:|---:|---|---:|---:|---:|');
    for (const members of SIZES) {
        for (let i = 0; i < 5; i++) await preview(members);
        const cpuBefore = await cpuSeconds();
        const runs = [];
        for (let i = 0; i < 40; i++) runs.push(await preview(members));
        const cpu = (await cpuSeconds()) - cpuBefore;
        const ok = runs.filter((r) => r.status === 200);
        if (ok.length !== runs.length) throw new Error(`${runs.length - ok.length} requests failed (status ${runs.find((r) => r.status !== 200).status})`);
        const { summary } = ok.at(-1);
        console.log(`| ${members} | ${members * 3} | ${summary.greedyTransfers} → ${summary.transfers} | ${summary.directTransfers} | ${fixed(percentile(ok.map((r) => r.computeMs), 50), 2)} | ${fixed((cpu * 1000) / ok.length, 2)} |`);
    }
}

async function concurrencySteps() {
    console.log(`\nSettlement preview under load — ${BASE_URL}, ${MEMBERS} members, ${SECONDS}s per step\n`);
    for (let i = 0; i < 10; i++) await preview(MEMBERS);
    console.log('| concurrency | requests | ok | 429 | 503 shed | failed | ok/s | p50 ms | p95 ms | p99 ms | compute p50 ms | CPU cores | CPU ms / ok |');
    console.log('|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
    for (const concurrency of STEPS) {
        const r = await step(concurrency);
        console.log(`| ${r.concurrency} | ${r.requests} | ${r.ok} | ${r.rateLimited} | ${r.shed} | ${r.failed} | ${fixed(r.throughput)} | ${fixed(r.p50, 0)} | ${fixed(r.p95, 0)} | ${fixed(r.p99, 0)} | ${fixed(r.computeP50, 1)} | ${fixed(r.cores, 2)} | ${fixed(r.cpuMsPerOk, 1)} |`);
    }
}

try {
    if (SIZES) await sizes();
    else await concurrencySteps();
} catch (error) {
    console.error(`load-preview: ${error.message}`);
    process.exit(1);
}
