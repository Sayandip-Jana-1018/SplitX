#!/usr/bin/env node
/**
 * ops-api: the cluster half of /ops (D-097), inside the cluster, where only
 * the application's own pods may reach it (k8s/ops/networkpolicy.yaml).
 *
 *   GET    /v1/readings   every reading /ops shows, at most 5 s old
 *   POST   /v1/traffic    start a traffic lab run: { rate, seconds }, capped by the lab
 *   DELETE /v1/traffic    stop it
 *   GET    /healthz       for the kubelet
 *
 * Each reading is one real source, read now, saying where it came from and
 * when; a source that can't be read says why (lib/reading.mjs). Nothing is
 * filled in, and nothing that identifies the AWS account is returned.
 */
import { createServer } from 'node:http';
import { cached, forget, readSource } from '../lib/reading.mjs';
import { CHARTS, GAUGES } from './queries.mjs';
import { alertmanagerAlerts, kube, labCommand, labStatus, lokiTail, nexusEvidence, promQuery, promRange } from './sources.mjs';
import {
    JENKINS_RESULTS, byLabel, scalar, series, summariseAlerts, summariseAutoscaler, summariseEvidence, summariseLogs, summariseNodes, summarisePods,
} from './summaries.mjs';

const PORT = Number(process.env.PORT ?? 8080);
const TARGET = process.env.PLATFORM_TARGET ?? 'unknown';
// Imported only when there is an AWS role to use, so Kind never loads the SDK.
const aws = process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI ? await import('./aws.mjs') : null;
const noRole = () => Promise.reject(new Error('no AWS role here: only the EKS platform gives ops-api one (EKS Pod Identity)'));

const log = (fields) => process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), service: 'ops-api', ...fields }) + '\n');

/** Everything /ops shows from inside the cluster. */
function readings() {
    return cached('readings', 5_000, async () => {
        const nodeList = kube('/api/v1/nodes');
        // Handled here at once: Node ends the process on a rejection nobody is
        // listening to yet, and the readings below await it only later.
        nodeList.catch(() => {});
        const nodes = readSource('Kubernetes API: nodes, and metrics-server', async () => {
            const metrics = await kube('/apis/metrics.k8s.io/v1beta1/nodes').catch(() => ({ items: [] }));
            return summariseNodes(await nodeList, metrics);
        });
        const workloads = readSource('Kubernetes API: the application\'s pods', async () => {
            const pods = await kube('/api/v1/namespaces/splitx/pods?labelSelector=' + encodeURIComponent('app.kubernetes.io/name=splitx'));
            // The zones are a courtesy: pods are listed even when nodes can't be.
            return summarisePods(pods, summariseNodes(await nodeList.catch(() => ({ items: [] })), { items: [] }));
        });
        const autoscaler = readSource('Kubernetes API: the HorizontalPodAutoscaler', async () =>
            summariseAutoscaler(await kube('/apis/autoscaling/v2/namespaces/splitx/horizontalpodautoscalers/splitx')));
        const admissions = readSource('Prometheus: Kyverno\'s admission requests, last 24 h', async () => {
            const counts = byLabel(await promQuery(GAUGES.admissions), 'request_allowed');
            return { allowed: Math.round(counts.true ?? 0), refused: Math.round(counts.false ?? 0) };
        });
        const traffic = readSource('Prometheus: the service dashboard\'s queries', async () => {
            const end = Math.floor(Date.now() / 1000);
            const start = end - 15 * 60;
            const entries = await Promise.all(Object.entries(CHARTS).map(async ([key, chart]) =>
                [key, { title: chart.title, unit: chart.unit, panel: chart.panel, points: series(await promRange(chart.expr, start, end, 15)) }]));
            return { from: start, to: end, step: 15, charts: Object.fromEntries(entries) };
        });
        const servingPods = readSource('Prometheus: requests per pod', async () =>
            Object.entries(byLabel(await promQuery(GAUGES.podsServing), 'pod')).map(([pod, rate]) => ({ pod, rate })).sort((a, b) => a.pod.localeCompare(b.pod)));
        const lab = readSource('the traffic lab', labStatus);
        const alerts = readSource('Alertmanager', async () => summariseAlerts(await alertmanagerAlerts()));
        const logs = readSource('Loki: the application\'s log, last 15 minutes', async () => summariseLogs(await lokiTail()));
        const delivery = readSource('Prometheus: Jenkins\' metrics', async () => {
            const [result, duration] = await Promise.all([promQuery(GAUGES.lastDeploy), promQuery(GAUGES.lastDeployMs)]);
            const ordinal = scalar(result);
            return { lastResult: ordinal === null ? null : JENKINS_RESULTS[ordinal] ?? 'unknown', lastSeconds: scalar(duration) === null ? null : Math.round(scalar(duration) / 1000) };
        });
        const evidence = readSource('Nexus: splitx-evidence', async () => summariseEvidence(await nexusEvidence()));
        const stacks = readSource('AWS CloudFormation', aws ? aws.readStacks : noRole);
        const eks = readSource('Amazon EKS', aws ? aws.readEks : noRole);
        const edge = readSource('Amazon CloudFront', aws ? aws.readEdge : noRole);
        const budget = readSource('AWS Budgets', aws ? aws.readBudget : noRole);
        const platform = readSource('the platform\'s facts, as cluster-up passed them', async () => ({
            target: TARGET,
            region: process.env.AWS_REGION ?? null,
            kubernetesVersion: process.env.KUBERNETES_VERSION ?? null,
            vpcCidr: process.env.VPC_CIDR ?? null,
            serviceCidr: process.env.SERVICE_CIDR ?? null,
            edge: process.env.EDGE_DOMAIN ?? null,
        }));

        const all = { nodes, workloads, autoscaler, admissions, traffic, servingPods, lab, alerts, logs, delivery, evidence, stacks, eks, edge, budget, platform };
        const values = await Promise.all(Object.values(all));
        return Object.fromEntries(Object.keys(all).map((name, index) => [name, values[index]]));
    });
}

async function readBody(req) {
    let text = '';
    for await (const chunk of req) {
        text += chunk;
        if (text.length > 1024) throw new Error('too large');
    }
    return text ? JSON.parse(text) : {};
}

function send(res, status, value) {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(value));
}

const server = createServer(async (req, res) => {
    const started = Date.now();
    const path = new URL(req.url ?? '/', 'http://ops-api').pathname;
    try {
        if (req.method === 'GET' && path === '/healthz') send(res, 200, { ok: true });
        else if (req.method === 'GET' && path === '/v1/readings') send(res, 200, await readings());
        else if (req.method === 'POST' && path === '/v1/traffic') {
            const body = await readBody(req).catch(() => null);
            if (!body) send(res, 400, { error: 'the body must be JSON, at most 1 KB' });
            else {
                const { status, answer } = await labCommand('POST', { rate: body.rate, seconds: body.seconds });
                // The next reading shows the lab as it is now.
                forget();
                send(res, status, answer);
            }
        } else if (req.method === 'DELETE' && path === '/v1/traffic') {
            const { status, answer } = await labCommand('DELETE');
            forget();
            send(res, status, answer);
        } else send(res, 404, { error: 'not here' });
    } catch (error) {
        send(res, 502, { error: error.message });
    }
    if (path !== '/healthz') log({ method: req.method, path, status: res.statusCode, ms: Date.now() - started });
});

server.listen(PORT, () => log({ msg: 'listening', port: PORT, target: TARGET, aws: Boolean(aws) }));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => process.exit(0)));
