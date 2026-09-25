/**
 * The in-cluster sources ops-api reads (D-097). Each call either answers or
 * throws a plain reason; readSource (lib/reading.mjs) turns that into the
 * reading /ops shows.
 */
import { readFileSync } from 'node:fs';
import { request } from 'node:https';

const TIMEOUT_MS = 5_000;

const URLS = {
    prometheus: process.env.PROMETHEUS_URL ?? 'http://kube-prometheus-stack-prometheus.monitoring.svc.cluster.local:9090',
    alertmanager: process.env.ALERTMANAGER_URL ?? 'http://kube-prometheus-stack-alertmanager.monitoring.svc.cluster.local:9093',
    loki: process.env.LOKI_URL ?? 'http://loki.monitoring.svc.cluster.local:3100',
    nexus: process.env.NEXUS_URL ?? 'http://nexus.nexus.svc.cluster.local:8081',
    lab: process.env.TRAFFIC_LAB_URL ?? 'http://traffic-lab.ops.svc.cluster.local:8080',
};

const SERVICE_ACCOUNT = '/var/run/secrets/kubernetes.io/serviceaccount';

/**
 * GET from the Kubernetes API as ops-api's own service account: the built-in
 * `view` role plus reading nodes (k8s/ops/ops-api.yaml), never Secrets.
 */
export function kube(path) {
    const host = process.env.KUBERNETES_SERVICE_HOST;
    if (!host) return Promise.reject(new Error('not running in a cluster'));
    // A projected token is rotated, so it is read for every call.
    const token = readFileSync(SERVICE_ACCOUNT + '/token', 'utf8').trim();
    const ca = readFileSync(SERVICE_ACCOUNT + '/ca.crt');
    return new Promise((resolve, reject) => {
        const req = request({
            host,
            port: process.env.KUBERNETES_SERVICE_PORT ?? 443,
            path,
            method: 'GET',
            ca,
            headers: { authorization: 'Bearer ' + token, accept: 'application/json' },
            timeout: TIMEOUT_MS,
        }, (res) => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => {
                if (res.statusCode !== 200) reject(new Error('the Kubernetes API answered ' + res.statusCode + ' for ' + path.split('?')[0]));
                else resolve(JSON.parse(body));
            });
        });
        req.on('timeout', () => req.destroy(Object.assign(new Error('timed out'), { name: 'TimeoutError' })));
        req.on('error', reject);
        req.end();
    });
}

/** The service a URL names, as /ops shows it: "loki", not the whole cluster address. */
function serviceOf(url) {
    const host = new URL(url).hostname;
    return /^[\d.]+$/.test(host) ? host : host.split('.')[0];
}

/** fetch, failing with what could not be reached and why, rather than "fetch failed". */
async function reach(url, init = {}) {
    try {
        return await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (error) {
        if (error?.name === 'TimeoutError' || error?.name === 'AbortError') throw error;
        const why = error?.cause?.code ?? error?.cause?.message ?? error?.message ?? 'no answer';
        throw new Error(serviceOf(url) + ' could not be reached (' + why + ')');
    }
}

async function getJson(url, init = {}) {
    const res = await reach(url, init);
    if (!res.ok) throw new Error(serviceOf(url) + ' answered ' + res.status);
    return res.json();
}

/** A PromQL instant query's result vector. */
export async function promQuery(expr) {
    const answer = await getJson(URLS.prometheus + '/api/v1/query?query=' + encodeURIComponent(expr));
    if (answer.status !== 'success') throw new Error('Prometheus: ' + (answer.error ?? 'the query failed'));
    return answer.data.result;
}

/** A PromQL range query's result matrix. */
export async function promRange(expr, start, end, step) {
    const query = new URLSearchParams({ query: expr, start: String(start), end: String(end), step: String(step) });
    const answer = await getJson(URLS.prometheus + '/api/v1/query_range?' + query);
    if (answer.status !== 'success') throw new Error('Prometheus: ' + (answer.error ?? 'the query failed'));
    return answer.data.result;
}

/** The alerts Alertmanager holds now, as it would route them. */
export function alertmanagerAlerts() {
    return getJson(URLS.alertmanager + '/api/v2/alerts?active=true&silenced=false&inhibited=false');
}

/** The application's newest log lines in Loki, from the last 15 minutes. */
export async function lokiTail(limit = 40) {
    const end = Date.now();
    const query = new URLSearchParams({
        query: '{namespace="splitx", container="splitx"}',
        limit: String(limit),
        direction: 'backward',
        start: String((end - 15 * 60_000) * 1_000_000),
        end: String(end * 1_000_000),
    });
    const answer = await getJson(URLS.loki + '/loki/api/v1/query_range?' + query);
    return answer.data?.result ?? [];
}

/**
 * The release evidence Jenkins stored in Nexus, newest first, as ops-api's own
 * read-only account (nexus/provision.mjs makes it).
 */
export async function nexusEvidence(maxPages = 5) {
    const password = process.env.NEXUS_OPS_PASSWORD;
    if (!password) throw new Error('no Nexus account configured for ops-api');
    const authorization = 'Basic ' + Buffer.from('ops:' + password).toString('base64');
    const assets = [];
    let token = null;
    for (let page = 0; page < maxPages; page++) {
        const query = new URLSearchParams({ repository: 'splitx-evidence', ...(token ? { continuationToken: token } : {}) });
        const answer = await getJson(URLS.nexus + '/service/rest/v1/assets?' + query, { headers: { authorization } });
        assets.push(...(answer.items ?? []));
        token = answer.continuationToken;
        if (!token) break;
    }
    return assets;
}

/** What the traffic lab is doing. */
export function labStatus() {
    return getJson(URLS.lab + '/v1/run');
}

/** Starts or stops a run in the traffic lab; returns its status code and answer. */
export async function labCommand(method, body) {
    const res = await reach(URLS.lab + '/v1/run', {
        method,
        headers: body ? { 'content-type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, answer: await res.json().catch(() => ({ error: 'the traffic lab answered ' + res.status })) };
}
