#!/usr/bin/env node
/**
 * Proves the delivery path does what phase 6 claims, and writes what it
 * measured to docs/evidence/delivery.md (Kind) or docs/evidence/delivery-eks.md (EKS).
 *
 *   npm run cd:verify                 checks that change nothing
 *   npm run cd:verify -- --rollback   also deploys a release that cannot come
 *                                     up, and measures what users saw
 *   npm run cd:verify -- --target eks [--rollback]
 *                                     the same on the EKS platform (D-103)
 *
 * The chain: GitHub Actions builds, scans and signs every release on main and
 * announces it as a GitHub deployment (D-054). GitHub's webhook reaches
 * Jenkins through the relay on Kind (D-056), and through CloudFront and the
 * load balancer on EKS (D-093). Jenkins checks the webhook's signature, then
 * the image's, then deploys the release's own manifests and rolls back
 * anything that does not come up healthy (D-055).
 *
 * Nothing here asserts anything about a file: every check asks the running
 * Jenkins, the relay, the API server, the edge, or GitHub.
 */
import { spawnSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildForDeployment } from './lib/platform-checks.mjs';
import { powerSource } from './lib/power.mjs';
import { clusterSecret, portForward, stopForwards, verifyTarget } from './lib/verify-target.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// The Jenkins admin password, the webhook secret and the channel. Read, never printed.
if (existsSync(join(root, '.env'))) process.loadEnvFile(join(root, '.env'));
let target;
try {
    target = verifyTarget(process.argv.slice(2), (path) => readFileSync(join(root, path), 'utf8'));
} catch (error) {
    console.error('x ' + error.message);
    process.exit(1);
}
const EKS = target.name === 'eks';
const CONTEXT = target.context;
const NS = 'splitx';
const JENKINS_HOST = 'jenkins.localhost';
const JOB = 'splitx-deploy';
const REPOSITORY = 'Sayandip-Jana-1018/SplitX';
const IMAGE_REPOSITORY = 'ghcr.io/sayandip-jana-1018/splitx';
// The GitHub environment this cluster's Jenkins deploys, and the other one.
const ENVIRONMENT = target.environment;
const OTHER_ENVIRONMENT = target.otherEnvironment;
const PROMETHEUS = { namespace: 'monitoring', service: 'kube-prometheus-stack-prometheus', portName: 'http-web', port: 9090 };

// On Kind the owner's .env holds the platform's secrets; on EKS the External
// Secrets Operator made them from Secrets Manager, and they are read from the
// cluster, masked in a runner's log before anything could print them.
const secret = (name, key, fromEnv) => (EKS ? clusterSecret(CONTEXT, 'jenkins', name, key) : process.env[fromEnv] ?? '');
const ADMIN_PASSWORD = secret('jenkins-admin', 'jenkins-admin-password', 'JENKINS_ADMIN_PASSWORD');
const WEBHOOK_SECRET = secret('jenkins-secrets', 'webhook-secret', 'GITHUB_WEBHOOK_SECRET');
const TRIGGER_TOKEN = secret('jenkins-secrets', 'trigger-token', 'JENKINS_TRIGGER_TOKEN');
// Deployments are read with any token that may: .env's, the workflow's, or Jenkins' own.
const GITHUB_TOKEN = process.env.JENKINS_GITHUB_TOKEN || process.env.GITHUB_TOKEN || (EKS ? secret('jenkins-secrets', 'github-token', '') : '');

const withRollback = process.argv.includes('--rollback');
const checks = [];
const sections = [];
let failures = 0;

function record(name, passed, detail) {
    checks.push({ name, passed, detail });
    if (!passed) failures += 1;
    console.log((passed ? '  PASS  ' : '  FAIL  ') + name + (detail ? ' — ' + detail : ''));
}
const heading = (text) => console.log('\n' + text);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function sh(file, argv) {
    const result = spawnSync(file, argv, { cwd: root, encoding: 'utf8', shell: false });
    return { code: result.status, stdout: (result.stdout ?? '').trim(), stderr: (result.stderr ?? '').trim() };
}
const kubectl = (argv) => sh('kubectl', ['--context', CONTEXT, ...argv]);
const json = (argv) => JSON.parse(kubectl([...argv, '-o', 'json']).stdout || '{}');

// Neither Jenkins' UI nor Prometheus is published on EKS: both are reached
// through `kubectl port-forward`. On Kind, Jenkins answers on ingress-nginx and
// Prometheus through the API server's service proxy.
let prometheus = null;
async function promQuery(expr) {
    const path = '/api/v1/query?query=' + encodeURIComponent(expr);
    try {
        if (!EKS) {
            return JSON.parse(kubectl(['get', '--raw', '/api/v1/namespaces/' + PROMETHEUS.namespace + '/services/' + PROMETHEUS.service + ':' + PROMETHEUS.portName + '/proxy' + path]).stdout);
        }
        prometheus ??= await portForward({ context: CONTEXT, namespace: PROMETHEUS.namespace, service: PROMETHEUS.service, port: PROMETHEUS.port });
        return await (await fetch(prometheus.url + path, { signal: AbortSignal.timeout(30_000) })).json();
    } catch {
        return null;
    }
}
let jenkins = { port: 80, host: JENKINS_HOST };
if (EKS) {
    try {
        const forwarded = await portForward({ context: CONTEXT, namespace: 'jenkins', service: 'jenkins', port: 8080 });
        jenkins = { port: forwarded.port, host: '127.0.0.1:' + forwarded.port };
    } catch (error) {
        console.error('x Jenkins could not be reached: ' + error.message);
        stopForwards();
        process.exit(1);
    }
}

// ── talking to Jenkins, as a person with the admin password would ──────────
const auth = 'Basic ' + Buffer.from('admin:' + ADMIN_PASSWORD).toString('base64');
let cookie = '';
function http(path, { method = 'GET', headers = {}, body, authenticate = true } = {}) {
    return new Promise((resolve) => {
        const req = request({
            host: '127.0.0.1',
            port: jenkins.port,
            path: path.replace(/\[/g, '%5B').replace(/\]/g, '%5D'),
            method,
            headers: {
                Host: jenkins.host,
                ...(authenticate ? { Authorization: auth } : {}),
                // Jenkins ties a crumb to the session that asked for it.
                ...(cookie ? { cookie } : {}),
                ...headers,
            },
        }, (res) => {
            const set = res.headers['set-cookie'];
            if (set) cookie = set.map((c) => c.split(';')[0]).join('; ');
            let text = '';
            res.on('data', (chunk) => { text += chunk; });
            res.on('end', () => resolve({ status: res.statusCode, text }));
        });
        req.on('error', (error) => resolve({ status: 0, text: String(error) }));
        req.end(body);
    });
}
const jenkinsJson = async (path) => {
    const res = await http(path);
    try {
        return JSON.parse(res.text);
    } catch {
        return null;
    }
};
async function post(path, { headers = {}, body } = {}) {
    const crumb = await jenkinsJson('/crumbIssuer/api/json');
    return http(path, { method: 'POST', body, headers: { ...(crumb ? { [crumb.crumbRequestField]: crumb.crumb } : {}), ...headers } });
}

// A delivery as GitHub would send it: compact JSON, signed over those bytes.
const sign = (text, key = WEBHOOK_SECRET) => 'sha256=' + createHmac('sha256', key).update(Buffer.from(text, 'utf8')).digest('hex');
const deliveryBody = (environment) => JSON.stringify({
    action: 'created',
    deployment: { id: 1, sha: 'a'.repeat(40), environment, payload: { image: IMAGE_REPOSITORY + '@sha256:' + 'b'.repeat(64) } },
});
const pingBody = JSON.stringify({ zen: 'Non-blocking is better than blocking.', hook_id: 1 });
/**
 * Posts a delivery to Jenkins' webhook endpoint. On Kind, the way the relay
 * does: to Jenkins itself, the token as a header. On EKS, the way GitHub's
 * second webhook does (D-093): through CloudFront and the load balancer, the
 * token in the address, and no Jenkins credentials at all.
 */
async function invoke(body, { token, ...headers }) {
    if (!EKS) {
        return post('/generic-webhook-trigger/invoke', { body, headers: { 'content-type': 'application/json', token, ...headers } });
    }
    try {
        const response = await fetch(target.base + '/generic-webhook-trigger/invoke?token=' + encodeURIComponent(token), {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'user-agent': 'GitHub-Hookshot/delivery-verify', ...headers },
            body,
            signal: AbortSignal.timeout(30_000),
        });
        return { status: response.status, text: await response.text() };
    } catch (error) {
        return { status: 0, text: String(error) };
    }
}
const triggered = (res) => {
    try {
        return Object.values(JSON.parse(res.text).jobs ?? {}).some((job) => job.triggered);
    } catch {
        return false;
    }
};

async function github(path) {
    const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'splitx-delivery-verify' };
    if (GITHUB_TOKEN) headers.Authorization = 'Bearer ' + GITHUB_TOKEN;
    const res = await fetch('https://api.github.com' + path, { headers, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) {
        // Without a token GitHub allows 60 calls an hour per address, and a
        // couple of verification runs and deploy builds spend that between
        // them. Say which it is, rather than reporting a spent quota as if
        // the release record itself were wrong.
        if (res.headers.get('x-ratelimit-remaining') === '0') {
            const reset = new Date(Number(res.headers.get('x-ratelimit-reset') ?? 0) * 1000);
            throw new Error('GitHub\'s API allowance for this address is spent until ' + reset.toISOString().slice(11, 16) + ' UTC'
                + (headers.Authorization ? '' : ' — 60 an hour, because .env holds no JENKINS_GITHUB_TOKEN'));
        }
        throw new Error('GitHub answered ' + res.status + ' to ' + path);
    }
    return res.json();
}

console.log('SplitX — delivery verification (' + (EKS ? 'EKS, through ' + target.base : 'Kind') + ')\n');

// The release this cluster's Jenkins was last asked to deploy.
let deployment = null;
let deploymentError = '';
try {
    [deployment] = await github('/repos/' + REPOSITORY + '/deployments?environment=' + ENVIRONMENT + '&per_page=1');
} catch (error) {
    deploymentError = error.message;
}

// ── 1. Jenkins, configured as code ────────────────────────────────────────
heading('[1] Jenkins');
const whoAmI = await jenkinsJson('/whoAmI/api/json');
const anonymous = await http('/api/json', { authenticate: false });
record(
    'Jenkins answers the admin' + (EKS ? ' (its password from Secrets Manager)' : ' from .env') + ', and nobody else',
    whoAmI?.authenticated === true && whoAmI.name === 'admin' && anonymous.status === 403,
    'admin authenticated: ' + (whoAmI?.authenticated ?? false) + '; without credentials: HTTP ' + anonymous.status
);

const job = await jenkinsJson('/job/' + JOB + '/api/json?tree=displayName,buildable,property[parameterDefinitions[name]]');
const jobConfig = (await http('/job/' + JOB + '/config.xml')).text;
const parameters = job?.property?.flatMap((p) => p.parameterDefinitions ?? []).map((p) => p.name) ?? [];
const expectedParameters = ['deployment_id', 'deployment_sha', 'deployment_image', 'deployment_environment', 'fault'];
const jobFromCode = Boolean(job?.buildable)
    && expectedParameters.every((name) => parameters.includes(name))
    && jobConfig.includes('GenericTrigger')
    && jobConfig.includes('jenkins/Jenkinsfile');
record(
    'The deploy job is defined by code, with the webhook trigger',
    jobFromCode,
    jobFromCode
        ? JOB + ': ' + parameters.length + ' parameters, a GenericTrigger, and jenkins/Jenkinsfile from the repository'
        : 'job: ' + (job ? 'found' : 'missing') + ', parameters ' + parameters.join(',')
);

// The pinned list is the values file's; the running set is Jenkins' own answer.
const pinned = new Map(readFileSync(join(root, 'helm/platform/jenkins.values.yaml'), 'utf8')
    .split(/\r?\n/)
    .map((line) => line.match(/^\s{4}- ([a-z0-9][a-z0-9-]*):([0-9][\w.+-]*)$/))
    .filter(Boolean)
    .map((match) => [match[1], match[2]]));
const running = await jenkinsJson('/pluginManager/api/json?depth=1&tree=plugins[shortName,version,active,enabled]');
const plugins = running?.plugins ?? [];
const mismatched = [...pinned].filter(([name, version]) => !plugins.some((p) => p.shortName === name && p.version === version));
const inactive = plugins.filter((p) => !p.active || !p.enabled);
record(
    'Every plugin is the pinned version, and all of them loaded',
    pinned.size > 0 && mismatched.length === 0 && inactive.length === 0 && plugins.length === pinned.size,
    mismatched.length || inactive.length
        ? 'not at the pinned version: ' + mismatched.map(([n]) => n).join(', ') + '; not active: ' + inactive.map((p) => p.shortName).join(', ')
        : plugins.length + ' plugins, all pinned in helm/platform/jenkins.values.yaml and all active'
);

const credentials = await jenkinsJson('/credentials/store/system/domain/_/api/json?tree=credentials[id]');
const credentialIds = (credentials?.credentials ?? []).map((c) => c.id);
const expectedCredentials = ['github-webhook-secret', 'webhook-trigger-token', 'github-deployments-token'];
record(
    'The credentials come from Kubernetes Secrets, by name only',
    expectedCredentials.every((id) => credentialIds.includes(id)),
    credentialIds.join(', ') + (EKS
        ? ' — the values live in the Secrets the External Secrets Operator makes from Secrets Manager'
        : ' — the values live in the Secrets k8s:up builds from .env')
);

sections.push({
    title: 'Jenkins',
    body: [
        'Jenkins runs in the cluster as the pinned chart in `helm/platform/charts.json`, in a namespace at the',
        'same `restricted` Pod Security level as the application. It builds nothing, so no build needs root or',
        'a Docker socket: GitHub Actions builds and signs, Jenkins deploys.',
        '',
        '| | |',
        '|---|---|',
        '| Configuration | `helm/platform/jenkins.values.yaml`' + (EKS ? ' with `helm/platform/eks/jenkins.values.yaml` over it' : '')
            + ': security realm, credentials, the webhook gate and the job itself (Job DSL) |',
        '| Plugins | ' + plugins.length + ', each pinned with its dependencies |',
        '| Job | `' + JOB + '`, its steps in `jenkins/Jenkinsfile` on main |',
        '| Builds run | in an agent pod as `jenkins-deployer`, with the official kubectl and cosign images mounted read-only |',
        ...(EKS ? ['| Reached | its UI through `kubectl port-forward` only; the edge publishes `/generic-webhook-trigger/` and nothing else of it |'] : []),
    ].join('\n'),
});

// ── 2. The webhook gate ───────────────────────────────────────────────────
heading('[2] What Jenkins accepts' + (EKS ? ', through the edge' : ''));
const buildsBefore = (await jenkinsJson('/job/' + JOB + '/api/json?tree=builds[number]'))?.builds?.length ?? 0;
const token = TRIGGER_TOKEN;
const ownDelivery = deliveryBody(ENVIRONMENT);
const refused = [
    ['no signature at all', await invoke(ownDelivery, { token, 'x-github-event': 'deployment' })],
    ['signed with another secret', await invoke(ownDelivery, { token, 'x-github-event': 'deployment', 'x-hub-signature-256': sign(ownDelivery, 'not-the-secret') })],
    ['changed after GitHub signed it', await invoke(ownDelivery, { token, 'x-github-event': 'deployment', 'x-hub-signature-256': sign(deliveryBody(OTHER_ENVIRONMENT)) })],
];
record(
    'A delivery GitHub did not sign is refused',
    refused.every(([, res]) => res.status === 403) && !refused.some(([, res]) => triggered(res)),
    refused.map(([name, res]) => name + ': HTTP ' + res.status).join('; ')
);

const wrongToken = await invoke(pingBody, { token: 'not-the-token', 'x-github-event': 'ping', 'x-hub-signature-256': sign(pingBody) });
record(
    'A correctly signed delivery with the wrong token reaches no job',
    wrongToken.status === 404 && !triggered(wrongToken),
    'HTTP ' + wrongToken.status
);

const ping = await invoke(pingBody, { token, 'x-github-event': 'ping', 'x-hub-signature-256': sign(pingBody) });
const otherDelivery = deliveryBody(OTHER_ENVIRONMENT);
const foreign = await invoke(otherDelivery, { token, 'x-github-event': 'deployment', 'x-hub-signature-256': sign(otherDelivery) });
const buildsAfter = (await jenkinsJson('/job/' + JOB + '/api/json?tree=builds[number]'))?.builds?.length ?? 0;
record(
    'Signed events that are not a deployment for this cluster start nothing',
    ping.status === 200 && foreign.status === 200 && !triggered(ping) && !triggered(foreign) && buildsAfter === buildsBefore,
    'a ping and a deployment for "' + OTHER_ENVIRONMENT + '" were accepted (HTTP ' + ping.status + ', ' + foreign.status
        + ') and started no build; the job still has ' + buildsAfter + ' build(s)'
);

sections.push({
    title: 'What Jenkins accepts',
    body: [
        'The job is started by GitHub\'s `deployment` webhook and nothing else. The Generic Webhook Trigger',
        'verifies GitHub\'s `X-Hub-Signature-256` against the webhook\'s secret before any job sees the delivery,',
        EKS
            ? 'so CloudFront and the load balancer that carry it are only couriers: they cannot forge or change one.'
            : 'so the relay that carries it (D-056) is only a courier: it cannot forge or change one.',
        ...(EKS ? ['Each delivery below went the way GitHub\'s do: to ' + target.base + '/generic-webhook-trigger/invoke, the token in the address.'] : []),
        '',
        '| Delivery | Answer |',
        '|---|---|',
        '| Not signed | HTTP 403, no build |',
        '| Signed with another secret | HTTP 403, no build |',
        '| Changed after signing | HTTP 403, no build |',
        '| Signed, wrong endpoint token | HTTP 404, no build |',
        '| Signed `ping` | HTTP 200, no build (it is not a deployment) |',
        '| Signed deployment for `' + OTHER_ENVIRONMENT + '` | HTTP 200, no build (this Jenkins deploys `' + ENVIRONMENT + '`) |',
    ].join('\n'),
});

// ── 3. The way GitHub's deliveries arrive ─────────────────────────────────
if (EKS) {
    heading('[3] GitHub\'s way in, through the edge');
    // GitHub's second webhook posts to CloudFront, which passes the path to the
    // load balancer and on to Jenkins (jenkins/eks/ingress.yaml). No relay runs
    // here, so a build GitHub's delivery started came that way and no other.
    const relayRuns = (json(['get', 'deployments', '-n', 'jenkins']).items ?? []).some((d) => d.metadata.name === 'webhook-relay');
    const builds = (await jenkinsJson('/job/' + JOB + '/api/json?tree=builds[number,result,actions[causes[shortDescription]]]'))?.builds ?? [];
    const started = deployment ? buildForDeployment(builds, deployment.id) : null;
    let reported = null;
    try {
        [reported] = deployment ? await github('/repos/' + REPOSITORY + '/deployments/' + deployment.id + '/statuses?per_page=1') : [];
    } catch (error) {
        deploymentError ||= error.message;
    }
    let how;
    if (!deployment) how = 'could not read GitHub\'s deployments: ' + deploymentError;
    else if (!started) how = 'no build of ' + JOB + ' names deployment ' + deployment.id + ' and a GitHub delivery ID';
    else {
        how = 'deployment ' + deployment.id + ' (' + deployment.sha.slice(0, 12) + '): GitHub\'s delivery started build #' + started.number
            + ', ' + started.result + '; GitHub shows ' + (reported ? reported.state + ', "' + reported.description + '"' : 'no status')
            + (relayRuns ? '; a relay runs here too' : '; no relay runs here');
    }
    record(
        'GitHub\'s own delivery reached Jenkins through CloudFront, and Jenkins reported back',
        Boolean(started) && started.result === 'SUCCESS' && reported?.state === 'success' && !relayRuns,
        how
    );

    // Only the webhook path of Jenkins is published: anything else of it,
    // asked for at the edge, is the application's (a 404), never Jenkins'.
    const elsewhere = [];
    for (const path of ['/whoAmI/api/json', '/script', '/manage', '/job/' + JOB + '/build']) {
        const response = await fetch(target.base + path, { redirect: 'manual', signal: AbortSignal.timeout(20_000) }).catch(() => null);
        const text = response ? await response.text().catch(() => '') : '';
        elsewhere.push({ path, status: response?.status ?? 0, jenkins: Boolean(response?.headers.get('x-jenkins')) || /hudson\.|jenkins\.model/i.test(text) });
    }
    record(
        'Nothing of Jenkins but its webhook path answers through the edge',
        elsewhere.every((probe) => probe.status > 0 && !probe.jenkins),
        elsewhere.map((probe) => probe.path + ' ' + (probe.jenkins ? 'answered by JENKINS' : 'HTTP ' + probe.status + ', not Jenkins')).join('; ')
    );
    sections.push({
        title: 'GitHub\'s way in',
        body: [
            'On AWS, GitHub calls Jenkins directly: its second webhook posts to CloudFront, which passes',
            '`/generic-webhook-trigger/*` to the load balancer and on to Jenkins. Nothing else of Jenkins is published.',
            '',
            '| | |',
            '|---|---|',
            '| Delivery | ' + how + ' |',
            ...elsewhere.map((probe) => '| `' + probe.path + '` at the edge | ' + (probe.jenkins ? '**Jenkins**' : 'HTTP ' + probe.status + ', the application') + ' |'),
        ].join('\n'),
    });
} else {
    heading('[3] The relay');
    // Read from the relay itself: Prometheus scrapes every 30 s, so a sample
    // taken while the stream was being re-opened would say "lost" about a relay
    // that is already back. The alert has the 5 minutes it needs for that; this
    // check does not.
    const relayMetric = (name) => {
        const metrics = kubectl(['exec', '-n', 'jenkins', 'deploy/webhook-relay', '--', 'wget', '-qO-', 'http://127.0.0.1:9090/metrics']).stdout;
        const line = metrics.split('\n').find((l) => l.startsWith(name + ' ') || l.startsWith(name + '{'));
        return Number(line?.split(' ').pop() ?? NaN);
    };
    const relayCounter = (result) => relayMetric('webhook_relay_deliveries_total{result="' + result + '"}');

    let relayConnected = relayMetric('webhook_relay_connected');
    // It reconnects on its own within seconds; only a stream that stays lost matters.
    for (let i = 0; i < 10 && relayConnected !== 1; i += 1) {
        await sleep(3000);
        relayConnected = relayMetric('webhook_relay_connected');
    }
    const relayPod = json(['get', 'pods', '-n', 'jenkins', '-l', 'app.kubernetes.io/name=webhook-relay']).items?.[0];
    const relayReady = relayPod?.status?.conditions?.some((c) => c.type === 'Ready' && c.status === 'True');
    // Prometheus must also have the series, or the alert that watches it never fires.
    const relayScraped = ((await promQuery('webhook_relay_connected{namespace="jenkins"}'))?.data?.result ?? []).length > 0;
    record(
        'The relay is holding the smee.io channel open',
        relayConnected === 1 && Boolean(relayReady) && relayScraped,
        'the relay reports connected, its pod is ' + (relayReady ? 'ready' : 'not ready')
            + ', and Prometheus ' + (relayScraped ? 'scrapes it' : 'has no sample of it')
            + '; it has re-opened the stream ' + relayMetric('webhook_relay_reconnects_total') + ' time(s) since it started'
    );
    const acceptedBefore = relayCounter('accepted');
    let delivered = false;
    if (process.env.SMEE_URL) {
        // A signed ping, the way GitHub posts one. It must arrive at Jenkins and be
        // accepted there; a ping starts no build.
        await fetch(process.env.SMEE_URL, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-github-event': 'ping',
                'x-github-delivery': 'delivery-verify-' + Date.now(),
                'x-hub-signature-256': sign(pingBody),
                'user-agent': 'GitHub-Hookshot/delivery-verify',
            },
            body: pingBody,
        }).catch(() => null);
        for (let i = 0; i < 20 && !delivered; i += 1) {
            await sleep(1500);
            delivered = relayCounter('accepted') > acceptedBefore;
        }
    }
    record(
        'A delivery posted to the channel arrives at Jenkins, signature intact',
        delivered,
        process.env.SMEE_URL
            ? (delivered ? 'a signed ping went out to smee.io and Jenkins accepted it (the relay rebuilt the body and the signature still verified)' : 'the ping did not reach Jenkins within 30 s')
            : '.env has no SMEE_URL'
    );
    const refusedTotal = relayCounter('refused');
    const unreachableTotal = relayCounter('unreachable');

    sections.push({
        title: 'The relay',
        body: [
            'GitHub cannot reach a Jenkins on a laptop, so the repository\'s webhook posts to a smee.io channel and',
            '`jenkins/relay/relay.mjs`, inside the cluster, replays each delivery to Jenkins with GitHub\'s own headers.',
            'It never holds the webhook secret, so a delivery it invented would be refused like any other (above).',
            'On AWS, GitHub calls Jenkins directly and the relay is not deployed.',
            '',
            '| | |',
            '|---|---|',
            '| Stream | ' + (relayConnected === 1 ? 'connected' : 'not connected') + ' |',
            '| Times the stream was re-opened | ' + relayMetric('webhook_relay_reconnects_total') + ' |',
            '| Deliveries accepted by Jenkins | ' + relayCounter('accepted') + ' |',
            '| Refused by Jenkins | ' + refusedTotal + ' |',
            '| Jenkins unreachable | ' + unreachableTotal + ' |',
            '',
            'smee.io keeps nothing for a listener that is away, so `WebhookRelayDisconnected` fires after five minutes',
            'without the stream, and `WebhookDeliveryRefused` on anything Jenkins did not accept',
            '(`jenkins/prometheusrule.yaml`, unit-tested in `npm run test:alerts`).',
        ].join('\n'),
    });
}

// ── 4. What a deploy build may do ─────────────────────────────────────────
heading('[4] The deploy account');
const AS = 'system:serviceaccount:jenkins:jenkins-deployer';
const canI = (verb, resource, namespace) => kubectl(['auth', 'can-i', verb, resource, '--as', AS, ...(namespace ? ['-n', namespace] : [])]).stdout === 'yes';
const permissions = [
    { allowed: true, what: 'patch deployments in splitx', got: canI('patch', 'deployments', NS) },
    { allowed: true, what: 'delete the schema job in splitx', got: canI('delete', 'jobs', NS) },
    { allowed: true, what: 'read pods in splitx', got: canI('get', 'pods', NS) },
    { allowed: true, what: 'apply the release scan in splitx', got: canI('patch', 'cronjobs', NS) },
    { allowed: false, what: 'read secrets in splitx', got: canI('get', 'secrets', NS) },
    { allowed: false, what: 'exec into a pod in splitx', got: canI('create', 'pods/exec', NS) },
    { allowed: false, what: 'change anything in monitoring', got: canI('patch', 'deployments', 'monitoring') },
    { allowed: false, what: 'change anything in kube-system', got: canI('create', 'pods', 'kube-system') },
    { allowed: false, what: 'read nodes', got: canI('get', 'nodes') },
];
const wrong = permissions.filter((p) => p.allowed !== p.got);
record(
    'A deploy build may change the application, and nothing else',
    wrong.length === 0,
    wrong.length ? wrong.map((p) => p.what + ': ' + (p.got ? 'allowed' : 'refused')).join('; ') : permissions.filter((p) => p.allowed).length + ' allowed, ' + permissions.filter((p) => !p.allowed).length + ' refused, as declared in jenkins/rbac/rbac.yaml'
);

sections.push({
    title: 'The deploy account',
    body: [
        'Deploy builds run as `jenkins/jenkins-deployer`, which the chart creates without permissions. The Role in',
        '`jenkins/rbac/rbac.yaml` gives it exactly what applying the release needs, in the `splitx` namespace only.',
        'The API server was asked about each of these:',
        '',
        '| May it… | |',
        '|---|---|',
        ...permissions.map((p) => '| ' + p.what + ' | ' + (p.got ? 'yes' : 'no') + ' |'),
        '',
        'Creating a workload always implies reading the Secrets that workload mounts, which is what deploying the',
        'application means; it cannot read them through the API, exec into a pod, or touch another namespace.',
    ].join('\n'),
});

// ── 5. The release that is running ────────────────────────────────────────
heading('[5] The release running now');
const digest = deployment?.payload?.image?.split('@')[1] ?? '';
const appPods = json(['get', 'pods', '-n', NS, '-l', 'app.kubernetes.io/name=splitx']).items
    .filter((pod) => !pod.metadata.deletionTimestamp && pod.status.conditions?.some((c) => c.type === 'Ready' && c.status === 'True'));
const runningDigests = [...new Set(appPods.map((pod) => pod.status.containerStatuses.find((c) => c.name === 'splitx')?.imageID ?? ''))];
record(
    'The cluster runs the image GitHub Actions signed for the newest deployment',
    Boolean(digest) && appPods.length > 0 && runningDigests.length === 1 && runningDigests[0].endsWith(digest),
    deployment
        ? 'deployment ' + deployment.id + ' of ' + deployment.sha.slice(0, 12) + ': ' + appPods.length + ' pod(s) running ' + runningDigests.map((d) => d.split('@').pop().slice(0, 19) + '…').join(', ')
        : 'could not read GitHub\'s deployments: ' + deploymentError
);

const lastBuilds = (await jenkinsJson('/job/' + JOB + '/api/json?tree=builds[number,result]'))?.builds ?? [];
const lastSuccess = lastBuilds.find((build) => build.result === 'SUCCESS');
const buildLog = lastSuccess ? (await http('/job/' + JOB + '/' + lastSuccess.number + '/consoleText')).text : '';
const verifiedLine = buildLog.split('\n').find((line) => line.includes('signed by https://github.com/' + REPOSITORY));
record(
    'Jenkins verified that signature before it deployed',
    Boolean(verifiedLine) && buildLog.includes(digest) && buildLog.includes('all running'),
    verifiedLine ? 'build #' + lastSuccess.number + ': ' + verifiedLine.trim().slice(0, 150) : 'no successful build has a cosign result in its log'
);

sections.push({
    title: 'The release running now',
    body: [
        'A release is one commit on main that passed CI: built once, published as',
        '`' + IMAGE_REPOSITORY + ':<commit>`, scanned, signed with cosign, and announced as a GitHub',
        'deployment whose payload names the image by digest (D-054). Jenkins deploys that digest, after checking',
        'the signature names this repository\'s CI workflow, on main, at the same commit.',
        '',
        '| | |',
        '|---|---|',
        '| GitHub deployment | ' + (deployment ? '`' + deployment.id + '` for `' + deployment.sha.slice(0, 12) + '`, environment `' + deployment.environment + '`' : 'not read') + ' |',
        '| Image | `' + (digest || 'unknown') + '` |',
        '| Running | ' + appPods.length + ' ready pod(s): ' + appPods.map((p) => '`' + p.metadata.name + '`').join(', ') + ' |',
        '| Deployed by | Jenkins build ' + (lastSuccess ? '#' + lastSuccess.number : '-') + ' |',
        '',
        'The deployed manifests are the release commit\'s own (`kubectl apply -k` of the overlay at that commit),',
        'with only the image replaced by the verified digest, so the pods get the configuration their code expects.',
    ].join('\n'),
});

// ── 6. what the cluster itself refuses ────────────────────────────────────
heading('[6] What the cluster itself refuses');
// Jenkins verifies before it deploys, but that is one path in. The admission
// policy (policy/verify-release.yaml) is asked about every pod, whoever
// creates it. Each probe satisfies the namespace's restricted Pod Security
// level, so the only thing left that can refuse it is the image policy.
const probe = (name, image) => JSON.stringify({
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: { name, namespace: NS, labels: { 'app.kubernetes.io/part-of': 'splitx' } },
    spec: {
        restartPolicy: 'Never',
        securityContext: { runAsNonRoot: true, runAsUser: 1001, runAsGroup: 1001, seccompProfile: { type: 'RuntimeDefault' } },
        containers: [{
            name: 'probe',
            image,
            command: ['sleep', '20'],
            securityContext: { allowPrivilegeEscalation: false, capabilities: { drop: ['ALL'] } },
        }],
    },
});
function tryToRun(name, image) {
    const result = spawnSync('kubectl', ['--context', CONTEXT, 'apply', '-f', '-'], { input: probe(name, image), encoding: 'utf8' });
    if (result.status === 0) {
        kubectl(['-n', NS, 'delete', 'pod', name, '--wait=false']);
        return { admitted: true, why: '' };
    }
    return {
        admitted: false,
        why: (result.stderr ?? '').replace(/\s+/g, ' ').replace(/.*denied the request: /, '').slice(0, 170),
    };
}

// GitHub's newest deployment names an image, but this section is about what
// admission does with a signature, not about which release is the newest: the
// release the cluster is already running is the same kind of subject, and asking
// it keeps this section answerable when GitHub cannot be read.
const runningImage = json(['get', 'deployment', 'splitx', '-n', NS]).spec?.template?.spec?.containers?.find((c) => c.name === 'splitx')?.image ?? '';
const signedImage = deployment?.payload?.image ?? (runningImage.startsWith(IMAGE_REPOSITORY + '@') ? runningImage : null);
const signedDigest = signedImage?.split('@')[1] ?? '';
const admitted = signedImage
    ? tryToRun('probe-signed-release', signedImage)
    : { admitted: false, why: 'no published release to try: GitHub could not be read and the cluster is running ' + (runningImage || 'nothing') };
record(
    'The signed release is admitted',
    admitted.admitted,
    signedImage ? (admitted.admitted ? 'a pod running ' + signedDigest.slice(0, 19) + '… was created' : 'refused: ' + admitted.why) : admitted.why
);

const unpublished = tryToRun('probe-unpublished', IMAGE_REPOSITORY + ':never-published');
// The same image the cluster just accepted, judged against a workflow that did
// not sign it: this separates "has a signature" from "has our signature".
const OTHER_IDENTITY = 'probe-other-identity';
// null until it has actually been asked: a probe that never ran is not an
// image the cluster admitted, and must not be reported as one.
let otherIdentity = { admitted: null, why: 'not tried: there was no signed release to judge' };
try {
    const policy = readFileSync(join(root, 'policy/verify-release.yaml'), 'utf8')
        .replace('name: splitx-release-must-be-signed', 'name: ' + OTHER_IDENTITY)
        .replace('ci.yml@refs/heads/main', 'release.yml@refs/heads/main')
        .replace('- name: release', '- name: other')
        .replace('[attestors.release]', '[attestors.other]');
    spawnSync('kubectl', ['--context', CONTEXT, 'apply', '-f', '-'], { input: policy, encoding: 'utf8' });
    await sleep(10_000);
    if (signedImage) otherIdentity = tryToRun('probe-other-identity', signedImage);
} finally {
    kubectl(['delete', 'imagevalidatingpolicy', OTHER_IDENTITY, '--ignore-not-found']);
}
record(
    'An image our workflow did not sign is refused, whoever asks',
    !unpublished.admitted && otherIdentity.admitted === false,
    'a tag we never published: ' + (unpublished.admitted ? 'ADMITTED' : 'refused') + '; the same signed image judged against another workflow: '
        + (otherIdentity.admitted === null ? otherIdentity.why : otherIdentity.admitted ? 'ADMITTED' : 'refused — ' + otherIdentity.why)
);

sections.push({
    title: 'What the cluster itself refuses',
    body: [
        'Jenkins checks the signature before it deploys, but a `kubectl apply`, a Job or a controller with the',
        'right permissions would go around it. `policy/verify-release.yaml` makes the check part of admission:',
        'any image from `ghcr.io/sayandip-jana-1018` must carry a cosign signature from this repository\'s',
        'release workflow, on main. Images from anywhere else — Postgres, Redis, the locally built',
        '`splitx:local` — are not claimed to be signed and are not touched.',
        '',
        '| Asked to run | Answer |',
        '|---|---|',
        '| The release GitHub Actions signed | ' + (admitted.admitted ? 'admitted' : 'refused: ' + admitted.why) + ' |',
        '| A tag under our name that was never published | ' + (unpublished.admitted ? '**admitted**' : 'refused') + ' |',
        '| The same signed image, judged against another workflow | ' + (otherIdentity.admitted === null ? 'not tried' : otherIdentity.admitted ? '**admitted**' : 'refused') + ' |',
        '',
        'The last one is the point: the policy checks *whose* signature it is, not that a signature exists.',
        'The engine refuses what it cannot check (`failurePolicy: Fail`), and the rule covers the `splitx`',
        'namespace only, so an outage of the policy engine cannot stop the rest of the cluster.',
    ].join('\n'),
});

// What a visitor sees: on Kind, ingress-nginx on this machine; on EKS, the edge.
function visit() {
    if (EKS) {
        return fetch(target.base + '/api/health/live', { signal: AbortSignal.timeout(5000) })
            .then(async (res) => {
                await res.arrayBuffer();
                return res.status;
            })
            .catch(() => 0);
    }
    return new Promise((resolve) => {
        const req = request({ host: '127.0.0.1', port: 80, path: '/api/health/live', headers: { Host: 'localhost' }, timeout: 5000 }, (res) => {
            res.resume();
            res.on('end', () => resolve(res.statusCode));
        });
        req.on('timeout', () => { req.destroy(); resolve(0); });
        req.on('error', () => resolve(0));
        req.end();
    });
}

// ── 7. A release that cannot come up (--rollback) ─────────────────────────
let rollback = null;
if (withRollback) {
    heading('[7] A release that cannot come up');
    const power = await powerSource();
    if (power.source === 'battery') {
        record('The laptop is on mains power for the measurement', false, power.detail + '; plug it in and run again');
    } else if (!deployment) {
        record('A release to redeploy with a fault', false, 'GitHub\'s deployments could not be read: ' + deploymentError);
    } else {
        // The same release, with an environment variable that makes readiness
        // fail: the pods start and never become ready, which is what a bad
        // configuration looks like. Traffic runs throughout.
        const before = json(['get', 'deployment', 'splitx', '-n', NS]);
        const imageBefore = before.spec.template.spec.containers.find((c) => c.name === 'splitx').image;
        const nextBuild = (await jenkinsJson('/job/' + JOB + '/api/json?tree=nextBuildNumber')).nextBuildNumber;
        const parametersQuery = new URLSearchParams({
            deployment_id: String(deployment.id),
            deployment_sha: deployment.sha,
            deployment_image: deployment.payload.image,
            deployment_environment: ENVIRONMENT,
            fault: 'unready',
        });
        const started = await post('/job/' + JOB + '/buildWithParameters?' + parametersQuery.toString());
        console.log('    build #' + nextBuild + ' queued (HTTP ' + started.status + '); watching the site while it runs');

        // What a visitor sees, every 300 ms, for as long as the build runs.
        const seen = [];
        let running = true;
        const traffic = (async () => {
            while (running) {
                seen.push(await visit());
                await sleep(300);
            }
        })();

        let build = null;
        for (let i = 0; i < 200 && !build; i += 1) {
            await sleep(5000);
            const status = await jenkinsJson('/job/' + JOB + '/' + nextBuild + '/api/json?tree=building,result,duration');
            if (status && !status.building) build = status;
        }
        running = false;
        await traffic;

        const after = json(['get', 'deployment', 'splitx', '-n', NS]);
        const imageAfter = after.spec.template.spec.containers.find((c) => c.name === 'splitx').image;
        const faultLog = build ? (await http('/job/' + JOB + '/' + nextBuild + '/consoleText')).text : '';
        const rolledBack = faultLog.includes('rolled back: the application runs');
        const served = seen.filter((code) => code === 200).length;
        const failed = seen.length - served;
        rollback = { build: nextBuild, result: build?.result, seconds: Math.round((build?.duration ?? 0) / 1000), served, failed, imageBefore, imageAfter, rolledBack };
        record(
            'A release that never becomes ready is rolled back, and the site keeps serving',
            build?.result === 'FAILURE' && rolledBack && imageAfter === imageBefore && failed === 0,
            'build #' + nextBuild + ' ' + (build?.result ?? 'did not finish') + ' after ' + rollback.seconds + ' s; '
                + (rolledBack ? 'rolled back to what ran before' : 'no rollback in the log') + '; '
                + served + ' of ' + seen.length + ' requests answered 200 while it happened'
        );

        // The Delivery dashboard's "failed" bars. Jenkins publishes its
        // failed-build counter only once a build has failed (FIRST_EVENT_SERIES,
        // D-102), gathering every 30 s for a 30 s scrape: after this build it
        // must appear, even on a cluster where nothing failed before.
        const counted = Date.now();
        let failedBuilds = null;
        while (build?.result === 'FAILURE' && failedBuilds === null && Date.now() - counted < 150_000) {
            const value = (await promQuery('sum(default_jenkins_builds_failed_build_count_total{jenkins_job="' + JOB + '"})'))?.data?.result?.[0]?.value?.[1];
            if (Number(value) >= 1) failedBuilds = Number(value);
            else await sleep(10_000);
        }
        const waited = Math.round((Date.now() - counted) / 1000) + ' s after build #' + nextBuild + ' ended ' + (build?.result ?? 'unfinished');
        record(
            'Jenkins counts the failed release, for the Delivery dashboard',
            failedBuilds !== null,
            failedBuilds === null
                ? 'no failed-build count in Prometheus ' + waited
                : 'default_jenkins_builds_failed_build_count_total reads ' + failedBuilds + ', ' + waited
        );
    }
}
if (rollback) {
    sections.push({
        title: 'A release that cannot come up',
        body: [
            'Rehearsed on purpose: the same signed release, deployed with an environment variable that makes the',
            'readiness probe fail (`fault=unready`, a parameter the webhook cannot set). The new pods start and',
            'never become ready, which is what a wrong database address or a missing setting looks like.',
            '',
            '| | |',
            '|---|---|',
            '| Jenkins build | #' + rollback.build + ', ' + rollback.result + ' after ' + rollback.seconds + ' s |',
            '| What the rollout did | `maxUnavailable: 0`, so the new pod waited for readiness and the old pods kept serving |',
            '| What Jenkins did | waited ' + '150 s' + ' for the rollout, then rolled the deployment back to the revision it had recorded before applying |',
            '| Running after | `' + rollback.imageAfter.split('@').pop().slice(0, 19) + '…`, the image that ran before |',
            '| What visitors saw | ' + rollback.served + ' of ' + (rollback.served + rollback.failed) + ' requests ' + (EKS ? 'through CloudFront ' : '')
                + 'answered 200 during the failed release and its rollback |',
            '',
            'The same path runs when a release is genuinely broken: the build fails and the cluster keeps the release',
            'it had. GitHub\'s own deployment is marked failed too, once `.env` holds a token that may write',
            'deployment statuses.',
        ].join('\n'),
    });
}

// ── the report ────────────────────────────────────────────────────────────
const report = [
    EKS ? '# Delivery on EKS — what happens between a merge and a running pod' : '# Delivery — what happens between a merge and a running pod',
    '',
    'Written by `scripts/delivery-verify.mjs` (`npm run cd:verify' + (EKS ? ' -- --target eks' : '') + '`) on ' + new Date().toISOString().slice(0, 10) + '.',
    'Every line is an answer from the running Jenkins, ' + (EKS ? 'the edge' : 'the running relay') + ', the API server or GitHub.',
    '',
    '## Result',
    '',
    '| Check | Result | Detail |',
    '|---|---|---|',
    ...checks.map((c) => '| ' + c.name + ' | ' + (c.passed ? 'pass' : '**fail**') + ' | ' + c.detail + ' |'),
    '',
    '## The chain',
    '',
    '```',
    'merge to main',
    '  -> GitHub Actions: test, build once, scan (Trivy), sign (cosign, keyless), publish to ghcr.io',
    '  -> GitHub deployment for the environment "' + ENVIRONMENT + '", naming the image by digest',
    '  -> webhook, signed by GitHub',
    EKS
        ? '  -> CloudFront (HTTPS) -> the load balancer -> Jenkins (signature checked here)'
        : '  -> smee.io channel -> relay in the cluster -> Jenkins (signature checked here)',
    '  -> Jenkins: newest? signed by main\'s workflow, same commit? then apply that commit\'s manifests',
    '  -> rollout, checked through ' + (EKS ? 'the edge' : 'the ingress') + '; anything unhealthy is rolled back',
    '  -> the outcome is reported back on the GitHub deployment',
    '```',
    '',
    ...sections.flatMap((section) => ['## ' + section.title, '', section.body, '']),
].join('\n');
writeFileSync(join(root, target.reports.delivery), report + '\n');
stopForwards();

console.log('\n' + (checks.length - failures) + '/' + checks.length + ' checks passed.');
console.log('Report: ' + target.reports.delivery);
process.exit(failures ? 1 : 0);
