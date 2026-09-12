#!/usr/bin/env node
/**
 * Proves the Prometheus pipeline records real traffic, exactly once.
 *
 * Sends a known mix of requests to ONE running instance, scrapes /api/metrics
 * before and after, and fails unless the counters moved by the right amount
 * and carry the true status codes and route patterns. Point it at a single
 * process (Docker container, `kubectl port-forward pod/...`) — behind a
 * load-balanced Service the requests land on other pods and the delta won't add up.
 *
 *   node --env-file=.env scripts/verify-metrics.mjs [baseUrl]
 */

const BASE_URL = (process.argv[2] || process.env.BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const TOKEN = process.env.METRICS_TOKEN;
const ROUNDS = Number(process.env.ROUNDS || 10);

// Requests that reach a route: counted from Next's request span.
const ROUTED = [
    { path: '/api/health/live', expect: 200, route: '/api/health/live' },
    { path: '/api/me', expect: 401, route: '/api/me' },
    { path: '/api/this-route-does-not-exist', expect: 404 },
];
// Requests the proxy answers itself: counted by the proxy.
const PROXIED = [{ path: '/dashboard', expect: 307, decision: 'redirect_login' }];

function parseSamples(text) {
    const samples = [];
    for (const line of text.split('\n')) {
        if (!line || line.startsWith('#')) continue;
        const match = line.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{(.*)\})?\s+(\S+)/);
        if (!match) continue;
        const labels = {};
        for (const [, key, value] of (match[2] || '').matchAll(/(\w+)="((?:[^"\\]|\\.)*)"/g)) {
            labels[key] = value;
        }
        samples.push({ name: match[1], labels, value: Number(match[3]) });
    }
    return samples;
}

const sum = (samples, name, where = () => true) =>
    samples.filter((s) => s.name === name && where(s.labels)).reduce((total, s) => total + s.value, 0);

async function scrape() {
    const res = await fetch(`${BASE_URL}/api/metrics`, {
        headers: TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {},
    });
    if (!res.ok) throw new Error(`scrape failed: HTTP ${res.status} ${await res.text()}`);
    return parseSamples(await res.text());
}

async function hit(path) {
    const res = await fetch(`${BASE_URL}${path}`, { redirect: 'manual' });
    await res.arrayBuffer();
    return res.status;
}

const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: Boolean(ok), detail });

try {
    if (TOKEN) {
        check('scrape without a token is refused', (await hit('/api/metrics')) === 401);
    } else {
        check('METRICS_TOKEN provided to the verifier', false, 'run with --env-file=.env');
    }

    const before = await scrape();

    const seen = new Map();
    for (let round = 0; round < ROUNDS; round++) {
        for (const request of [...ROUTED, ...PROXIED]) {
            const status = await hit(request.path);
            seen.set(request.path, (seen.get(request.path) || new Set()).add(status));
        }
    }
    for (const request of [...ROUTED, ...PROXIED]) {
        const statuses = [...seen.get(request.path)];
        const throttled = statuses.includes(429) ? ' — rate limited by the proxy (50/min per IP); wait a minute or lower ROUNDS' : '';
        check(`${request.path} answered ${request.expect}`, statuses.length === 1 && statuses[0] === request.expect, `saw ${statuses.join(', ')}${throttled}`);
    }

    // Let the last request's span close before reading the counters.
    await new Promise((resolve) => setTimeout(resolve, 300));
    const after = await scrape();
    const delta = (name, where) => sum(after, name, where) - sum(before, name, where);

    // Scrapes of /api/metrics are excluded: Prometheus may be scraping this same
    // instance concurrently. What remains must match the traffic exactly — double
    // counting would roughly double it, dropped requests would lower it.
    const notScrape = (labels) => labels.route !== '/api/metrics';
    const sent = ROUNDS * (ROUTED.length + PROXIED.length);
    const total = delta('splitx_http_requests_total', notScrape);
    check(`splitx_http_requests_total counted each response exactly once (${sent})`, total === sent, `+${total}`);

    const routedSent = ROUNDS * ROUTED.length;
    const observed = delta('splitx_http_request_duration_seconds_count', notScrape);
    check(`duration histogram observed each routed request exactly once (${routedSent})`, observed === routedSent, `+${observed}`);

    for (const request of ROUTED) {
        const where = (l) => l.status_code === String(request.expect) && (!request.route || l.route === request.route);
        const label = request.route ? `route="${request.route}",status_code="${request.expect}"` : `status_code="${request.expect}"`;
        check(`{${label}} rose by ${ROUNDS}`, delta('splitx_http_requests_total', where) === ROUNDS, `+${delta('splitx_http_requests_total', where)}`);
    }

    for (const request of PROXIED) {
        const where = (l) => l.route === '(proxy)' && l.status_code === String(request.expect);
        check(`proxy-answered {route="(proxy)",status_code="${request.expect}"} rose by ${ROUNDS}`, delta('splitx_http_requests_total', where) === ROUNDS, `+${delta('splitx_http_requests_total', where)}`);
        const decided = delta('splitx_proxy_decisions_total', (l) => l.decision === request.decision);
        check(`splitx_proxy_decisions_total{decision="${request.decision}"} rose by ${ROUNDS}`, decided === ROUNDS, `+${decided}`);
    }

    const proxyTimed = delta('splitx_proxy_duration_seconds_count');
    check('proxy time was observed for proxy-matched requests', proxyTimed >= ROUNDS * PROXIED.length, `+${proxyTimed}`);

    check('splitx_http_requests_in_flight is exported', after.some((s) => s.name === 'splitx_http_requests_in_flight'));
    const info = after.find((s) => s.name === 'splitx_app_info');
    check('splitx_app_info is exported', info, info ? JSON.stringify(info.labels) : 'missing');
} catch (error) {
    check('verifier ran to completion', false, error.message);
}

const width = Math.max(...results.map((r) => r.name.length));
for (const r of results) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(width)}  ${r.detail}`);
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed against ${BASE_URL}`);
process.exit(failed ? 1 : 0);
