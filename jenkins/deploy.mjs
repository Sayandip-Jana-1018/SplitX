#!/usr/bin/env node
/**
 * The steps of jenkins/Jenkinsfile (D-055), one per call:
 *
 *   node jenkins/deploy.mjs request    the request is well formed, for this cluster, and still the newest
 *   node jenkins/deploy.mjs verify     the image was signed by this repository's release job on main, for this commit
 *   node jenkins/deploy.mjs deploy     apply the commit's manifests with the verified image
 *   node jenkins/deploy.mjs wait       the database, the schema Job and the application roll out
 *   node jenkins/deploy.mjs check      every ready pod runs the image, and the edge serves only them
 *   node jenkins/deploy.mjs rollback   put the application back to the revision it had before `deploy`
 *   node jenkins/deploy.mjs report     tell the GitHub deployment how it went
 *
 * Inputs are the job's parameters (deployment_id, deployment_sha,
 * deployment_image, deployment_environment, fault), which arrive from a
 * webhook and are checked before use; DEPLOY_* from Jenkins' configuration;
 * BUILD_URL and BUILD_RESULT from the pipeline; GITHUB_TOKEN when the
 * github-deployments-token credential is set. kubectl and cosign are on PATH.
 * What one step learns for a later one is kept in deploy-state.json.
 *
 * Exit status: 0 done, 1 failed, 3 superseded (a newer deployment exists, so
 * this one is skipped, not failed).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';

const REPOSITORY = 'Sayandip-Jana-1018/SplitX';
const IMAGE_REPOSITORY = 'ghcr.io/sayandip-jana-1018/splitx';
// The certificate a release's signature must carry: this repository's CI
// workflow, running on main (D-054).
const SIGNER = 'https://github.com/' + REPOSITORY + '/.github/workflows/ci.yml@refs/heads/main';
const SIGNER_ISSUER = 'https://token.actions.githubusercontent.com';
const NAMESPACE = 'splitx';
const APP = 'splitx';
const STATE_FILE = 'deploy-state.json';
const SUPERSEDED = 3;

const env = process.env;
const deployment = {
    id: env.deployment_id ?? '',
    sha: env.deployment_sha ?? '',
    image: env.deployment_image ?? '',
    environment: env.deployment_environment ?? '',
    fault: env.fault || 'none',
};
const digest = deployment.image.split('@')[1] ?? '';

const state = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, 'utf8')) : {};
const save = () => writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
const say = (text) => console.log('    ' + text);
function fail(text) {
    console.error('x ' + text);
    process.exit(1);
}

function kubectl(argv, { json = false, allowFailure = false } = {}) {
    const result = spawnSync('kubectl', ['-n', NAMESPACE, ...argv, ...(json ? ['-o', 'json'] : [])], { encoding: 'utf8' });
    if (result.status !== 0 && !allowFailure) fail('kubectl ' + argv.join(' ') + ' failed:\n' + result.stderr.trim());
    if (!json) {
        if (result.stdout.trim()) say(result.stdout.trim().replace(/\n/g, '\n    '));
        return result;
    }
    return JSON.parse(result.stdout);
}

async function github(method, path, body) {
    const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'splitx-jenkins' };
    if (env.GITHUB_TOKEN) headers.Authorization = 'Bearer ' + env.GITHUB_TOKEN;
    const res = await fetch('https://api.github.com' + path, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    if (!res.ok) throw new Error('GitHub answered ' + res.status + ' to ' + method + ' ' + path + ': ' + text.slice(0, 200));
    return text ? JSON.parse(text) : null;
}

// Through the ingress controller, the way users arrive.
function edge(method, path, body) {
    return new Promise((resolve) => {
        const url = new URL(path, env.DEPLOY_EDGE_URL);
        const req = httpRequest({
            host: url.hostname,
            port: url.port || 80,
            path: url.pathname,
            method,
            headers: { Host: env.DEPLOY_EDGE_HOST, ...(body ? { 'content-type': 'application/json' } : {}) },
            timeout: 10_000,
        }, (res) => {
            let text = '';
            res.on('data', (chunk) => { text += chunk; });
            res.on('end', () => resolve({ status: res.statusCode, servedBy: res.headers['x-served-by'], text }));
        });
        req.on('timeout', () => req.destroy(new Error('timed out')));
        req.on('error', (error) => resolve({ status: 0, servedBy: null, text: String(error) }));
        req.end(body ? JSON.stringify(body) : undefined);
    });
}

const isReady = (pod) => pod.status.conditions?.some((c) => c.type === 'Ready' && c.status === 'True');
const appContainer = (spec) => spec.containers.find((c) => c.name === APP);

// ── request ────────────────────────────────────────────────────────────────
async function stepRequest() {
    const problems = [];
    if (!/^\d+$/.test(deployment.id)) problems.push('deployment_id "' + deployment.id + '" is not a GitHub deployment ID');
    if (!/^[0-9a-f]{40}$/.test(deployment.sha)) problems.push('deployment_sha "' + deployment.sha + '" is not a full commit SHA');
    if (!/^sha256:[0-9a-f]{64}$/.test(digest) || deployment.image !== IMAGE_REPOSITORY + '@' + digest) {
        problems.push('deployment_image "' + deployment.image + '" is not ' + IMAGE_REPOSITORY + ' pinned by digest');
    }
    if (deployment.environment !== env.DEPLOY_ENVIRONMENT) {
        problems.push('the deployment is for "' + deployment.environment + '"; this Jenkins deploys "' + env.DEPLOY_ENVIRONMENT + '"');
    }
    if (!['none', 'unready'].includes(deployment.fault)) problems.push('fault "' + deployment.fault + '" is not one this pipeline knows');
    if (problems.length) fail('refusing the request:\n  ' + problems.join('\n  '));

    // The webhook's signature proves GitHub sent it, not when. Asking GitHub
    // which deployment is the newest for this environment turns a replayed or
    // late delivery into a skip rather than a downgrade, and confirms the
    // commit and image the webhook named.
    const [newest] = await github('GET', '/repos/' + REPOSITORY + '/deployments?environment=' + encodeURIComponent(deployment.environment) + '&per_page=1');
    if (!newest) fail('GitHub lists no deployment for "' + deployment.environment + '"');
    if (String(newest.id) !== deployment.id) {
        state.superseded = newest.id;
        save();
        say('deployment ' + deployment.id + ' is superseded by ' + newest.id + ' (' + newest.sha.slice(0, 12) + '); skipping it');
        process.exit(SUPERSEDED);
    }
    if (newest.sha !== deployment.sha || newest.payload?.image !== deployment.image) {
        fail('GitHub\'s deployment ' + newest.id + ' names ' + newest.sha.slice(0, 12) + ' ' + newest.payload?.image + ', not what the webhook said');
    }
    say('deployment ' + deployment.id + ' of ' + deployment.sha.slice(0, 12) + ' to "' + deployment.environment + '" is the newest, and matches GitHub\'s record'
        + (deployment.fault === 'none' ? '' : '\n    REHEARSAL: deploying with the fault "' + deployment.fault + '"'));
    await report('in_progress', 'Jenkins is deploying ' + deployment.sha.slice(0, 12));
}

// ── verify ─────────────────────────────────────────────────────────────────
function stepVerify() {
    const result = spawnSync('cosign', [
        'verify',
        '--certificate-identity', SIGNER,
        '--certificate-oidc-issuer', SIGNER_ISSUER,
        // The certificate also records the commit the workflow ran on: the
        // image must have been built from exactly the commit being deployed.
        '--certificate-github-workflow-sha', deployment.sha,
        '--certificate-github-workflow-repository', REPOSITORY,
        deployment.image,
    ], { encoding: 'utf8' });
    if (result.status !== 0) {
        fail('the image is not signed by ' + SIGNER + ' for ' + deployment.sha.slice(0, 12) + ':\n' + result.stderr.trim());
    }
    const checks = result.stderr.split('\n').filter((line) => line.startsWith('  - '));
    say('signed by ' + SIGNER + ' at commit ' + deployment.sha.slice(0, 12) + '; cosign checked:\n    ' + checks.join('\n    '));
}

// ── deploy ─────────────────────────────────────────────────────────────────
function stepDeploy() {
    const before = kubectl(['get', 'deployment', APP], { json: true });
    state.revisionBefore = before.metadata.annotations?.['deployment.kubernetes.io/revision'] ?? null;
    state.imageBefore = appContainer(before.spec.template.spec).image;
    state.templateBefore = JSON.stringify(before.spec.template);
    save();
    say('running now: revision ' + state.revisionBefore + ', ' + state.imageBefore);

    // The commit's own manifests, with only the image replaced: the pods get
    // the configuration their code was written for.
    const kustomization = {
        apiVersion: 'kustomize.config.k8s.io/v1beta1',
        kind: 'Kustomization',
        resources: ['../release/' + env.DEPLOY_OVERLAY],
        images: [{ name: APP, newName: IMAGE_REPOSITORY, digest }],
    };
    if (deployment.fault === 'unready') {
        // A release whose pods start but never become ready, as a wrong
        // database address would make them: the rollback has to catch it.
        kustomization.patches = [{
            target: { kind: 'Deployment', name: APP },
            patch: JSON.stringify({
                apiVersion: 'apps/v1',
                kind: 'Deployment',
                metadata: { name: APP },
                spec: { template: { spec: { containers: [{ name: APP, env: [{ name: 'DATABASE_URL', value: 'postgresql://rehearsal@127.0.0.1:1/unreachable' }] }] } } },
            }),
        }];
    }
    mkdirSync('overlay', { recursive: true });
    writeFileSync('overlay/kustomization.yaml', JSON.stringify(kustomization, null, 2));

    // A Job's pod template cannot change, so each release replaces the schema Job.
    kubectl(['delete', 'job', 'splitx-schema-init', '--ignore-not-found']);
    kubectl(['apply', '-k', 'overlay']);

    const after = kubectl(['get', 'deployment', APP], { json: true });
    state.changed = JSON.stringify(after.spec.template) !== state.templateBefore;
    save();
    say(state.changed ? 'the application now runs ' + appContainer(after.spec.template.spec).image : 'the application already ran this release; nothing to roll out');
}

// ── wait ───────────────────────────────────────────────────────────────────
function stepWait() {
    kubectl(['rollout', 'status', 'statefulset/splitx-postgres', '--timeout=240s']);
    kubectl(['rollout', 'status', 'deployment/splitx-redis', '--timeout=120s']);
    kubectl(['wait', '--for=condition=complete', 'job/splitx-schema-init', '--timeout=240s']);
    // New pods must become ready within this; maxUnavailable 0 keeps the old
    // ones serving meanwhile, so a release that never gets there costs nothing.
    kubectl(['rollout', 'status', 'deployment/' + APP, '--timeout=150s']);
}

// ── check ──────────────────────────────────────────────────────────────────
async function stepCheck() {
    // What each pod runs, by the digest the kubelet pulled, not the tag it asked for.
    const pods = kubectl(['get', 'pods', '-l', 'app.kubernetes.io/name=' + APP], { json: true }).items
        .filter((pod) => !pod.metadata.deletionTimestamp && isReady(pod));
    const running = pods.map((pod) => ({ name: pod.metadata.name, imageID: pod.status.containerStatuses.find((c) => c.name === APP)?.imageID ?? '' }));
    const stray = running.filter((pod) => !pod.imageID.endsWith(digest));
    if (!running.length) fail('no ready pod');
    if (stray.length) fail('ready pods not running ' + digest + ': ' + stray.map((pod) => pod.name + ' ' + pod.imageID).join(', '));
    say(running.length + ' ready pod(s), all running ' + digest.slice(0, 19) + '…: ' + running.map((pod) => pod.name).join(', '));

    // The edge must serve them, and only them: ten answers in a row from the
    // new pods, allowing a few seconds for the ingress to drop the old ones.
    const names = new Set(running.map((pod) => pod.name));
    let streak = 0;
    const deadline = Date.now() + 30_000;
    while (streak < 10 && Date.now() < deadline) {
        const res = await edge('GET', '/api/health/live');
        streak = res.status === 200 && names.has(res.servedBy) ? streak + 1 : 0;
        if (streak === 0) await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (streak < 10) fail('the edge did not serve only the new pods within 30 s');
    const plan = await edge('POST', '/api/settlements/preview', { scenario: { members: 50 } });
    const planned = plan.status === 200 ? JSON.parse(plan.text) : null;
    if (!planned?.success || !names.has(plan.servedBy)) fail('a settlement preview through the edge failed: HTTP ' + plan.status + ' ' + plan.text.slice(0, 200));
    say('the edge serves only the new pods; a 50-person plan came back from ' + plan.servedBy + ' with ' + planned.data.summary.transfers + ' transfers');
}

// ── rollback ───────────────────────────────────────────────────────────────
function stepRollback() {
    if (!state.changed) {
        say('the application was not changed; nothing to roll back');
        return;
    }
    if (!state.revisionBefore) fail('no earlier revision to return to');
    say('rolling back to revision ' + state.revisionBefore + ' (' + state.imageBefore + ')');
    kubectl(['rollout', 'undo', 'deployment/' + APP, '--to-revision=' + state.revisionBefore]);
    kubectl(['rollout', 'status', 'deployment/' + APP, '--timeout=150s']);
    const now = kubectl(['get', 'deployment', APP], { json: true });
    state.rolledBack = appContainer(now.spec.template.spec).image === state.imageBefore;
    save();
    if (!state.rolledBack) fail('after the rollback the application runs ' + appContainer(now.spec.template.spec).image);
    say('rolled back: the application runs ' + state.imageBefore + ' again');
}

// ── report ─────────────────────────────────────────────────────────────────
async function report(status, description) {
    if (!/^\d+$/.test(deployment.id)) return;
    if (!env.GITHUB_TOKEN) {
        say('not reported to GitHub (' + status + '): the github-deployments-token credential is empty');
        return;
    }
    await github('POST', '/repos/' + REPOSITORY + '/deployments/' + deployment.id + '/statuses', {
        state: status,
        description: description.slice(0, 140),
        log_url: env.BUILD_URL,
        environment_url: 'http://' + env.DEPLOY_EDGE_HOST + '/',
    });
    say('reported to GitHub deployment ' + deployment.id + ': ' + status);
}

async function stepReport() {
    const result = env.BUILD_RESULT;
    if (state.superseded) return report('inactive', 'Superseded by deployment ' + state.superseded);
    if (result === 'SUCCESS') return report('success', 'Deployed ' + deployment.sha.slice(0, 12) + ' and checked through the edge');
    const outcome = state.rolledBack ? '; rolled back to ' + String(state.imageBefore).split('@').pop().slice(0, 19)
        : state.changed ? '; rollback did not complete' : '; nothing was changed';
    return report(result === 'ABORTED' ? 'error' : 'failure', 'Failed' + outcome);
}

const steps = { request: stepRequest, verify: stepVerify, deploy: stepDeploy, wait: stepWait, check: stepCheck, rollback: stepRollback, report: stepReport };
const step = steps[process.argv[2]];
if (!step) fail('usage: node jenkins/deploy.mjs ' + Object.keys(steps).join('|'));
try {
    await step();
} catch (error) {
    fail(error.message);
}
