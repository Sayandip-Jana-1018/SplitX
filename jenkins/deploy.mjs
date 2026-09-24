#!/usr/bin/env node
/**
 * The steps of jenkins/Jenkinsfile (D-055), one per call:
 *
 *   node jenkins/deploy.mjs request    the request is well formed, for this cluster, and still the newest
 *   node jenkins/deploy.mjs verify     the image was signed by this repository's release job on main, for this commit
 *   node jenkins/deploy.mjs deploy     apply the commit's manifests with the verified image
 *   node jenkins/deploy.mjs wait       the database and the schema Job (where the overlay has them) and the application roll out
 *   node jenkins/deploy.mjs check      every ready pod runs the image, and the edge serves only them
 *                                      (Kind: through ingress-nginx; EKS: through CloudFront over HTTPS)
 *   node jenkins/deploy.mjs archive    cosign verifies the release's SBOM and vulnerability report; both go to
 *                                      Nexus with the deployment's record (D-096)
 *   node jenkins/deploy.mjs rollback   put the application back to the revision it had before `deploy`
 *   node jenkins/deploy.mjs report     tell the GitHub deployment how it went
 *
 * Inputs are the job's parameters (deployment_id, deployment_sha,
 * deployment_image, deployment_environment, fault), which arrive from a
 * webhook and are checked before use; DEPLOY_* from Jenkins' configuration;
 * BUILD_URL and BUILD_RESULT from the pipeline; GITHUB_TOKEN when the
 * github-deployments-token credential is set; NEXUS_USER and NEXUS_PASSWORD
 * from the nexus-evidence credential. kubectl and cosign are on PATH.
 * What one step learns for a later one is kept in deploy-state.json.
 *
 * Exit status: 0 done, 1 failed, 3 superseded (a newer deployment exists, so
 * this one is skipped, not failed).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

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

function kubectl(argv, { json = false, allowFailure = false, quiet = false } = {}) {
    const result = spawnSync('kubectl', ['-n', NAMESPACE, ...argv, ...(json ? ['-o', 'json'] : [])], { encoding: 'utf8' });
    if (result.status !== 0 && !allowFailure) fail('kubectl ' + argv.join(' ') + ' failed:\n' + result.stderr.trim());
    if (!json) {
        if (result.stdout.trim() && !quiet) say(result.stdout.trim().replace(/\n/g, '\n    '));
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
    if (!res.ok) {
        // A spent allowance is not a broken release, and GitHub's own words for
        // it name the address it counted — which does not belong in a build log
        // that is read out loud. Say what happened in ours.
        if (res.headers.get('x-ratelimit-remaining') === '0') {
            const reset = new Date(Number(res.headers.get('x-ratelimit-reset') ?? 0) * 1000);
            throw new Error('GitHub\'s API allowance is spent until ' + reset.toISOString().slice(11, 16) + ' UTC'
                + (headers.Authorization ? '' : ' — 60 an hour, because this Jenkins has no GitHub token'));
        }
        throw new Error('GitHub answered ' + res.status + ' to ' + method + ' ' + path + ': ' + text.slice(0, 200));
    }
    return text ? JSON.parse(text) : null;
}

// The way users arrive: through the ingress controller on Kind, and through
// CloudFront over HTTPS on EKS, where DEPLOY_EDGE_URL is the edge itself.
function edge(method, path, body) {
    return new Promise((resolve) => {
        const url = new URL(path, env.DEPLOY_EDGE_URL);
        const secure = url.protocol === 'https:';
        const req = (secure ? httpsRequest : httpRequest)({
            host: url.hostname,
            port: url.port || (secure ? 443 : 80),
            path: url.pathname,
            method,
            // Over HTTPS the certificate is checked against this name too.
            servername: secure ? env.DEPLOY_EDGE_HOST : undefined,
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
    // The overlay decides what there is to wait for: Kind's has its own
    // Postgres and a schema Job; the AWS overlay uses a Neon branch that
    // already has the schema, so it has neither.
    const has = (object) => kubectl(['get', object, '--ignore-not-found', '-o', 'name'], { json: false, allowFailure: true, quiet: true }).stdout.trim() !== '';
    if (has('statefulset/splitx-postgres')) kubectl(['rollout', 'status', 'statefulset/splitx-postgres', '--timeout=240s']);
    kubectl(['rollout', 'status', 'deployment/splitx-redis', '--timeout=120s']);
    if (has('job/splitx-schema-init')) kubectl(['wait', '--for=condition=complete', 'job/splitx-schema-init', '--timeout=240s']);
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
    // For the deployment's record in Nexus (archive).
    state.pods = running.map((pod) => pod.name);
    save();

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

// ── archive ────────────────────────────────────────────────────────────────
const EVIDENCE_REPOSITORY = 'splitx-evidence';

/**
 * The newest attestation of one type that cosign verifies for this release,
 * decoded to what it attests: signed by the release job on main, for exactly
 * this commit, like the image itself (stepVerify).
 */
function verifiedPredicate(type) {
    const result = spawnSync('cosign', [
        'verify-attestation',
        '--type', type,
        '--certificate-identity', SIGNER,
        '--certificate-oidc-issuer', SIGNER_ISSUER,
        '--certificate-github-workflow-sha', deployment.sha,
        '--certificate-github-workflow-repository', REPOSITORY,
        deployment.image,
    ], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    if (result.status !== 0) throw new Error('the ' + type + ' attestation did not verify: ' + result.stderr.trim().split('\n').pop());
    // One JSON document per verified attestation: a DSSE envelope, or a bundle
    // holding one, whose payload is the in-toto statement.
    const statements = result.stdout.split('\n').filter((line) => line.trim().startsWith('{')).map((line) => {
        const envelope = JSON.parse(line);
        const payload = envelope.payload ?? envelope.dsseEnvelope?.payload;
        return JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
    });
    if (!statements.length) throw new Error('cosign verified no ' + type + ' attestation');
    return statements.at(-1).predicate;
}

async function nexusPut(path, body) {
    const url = env.DEPLOY_NEXUS_URL + '/repository/' + EVIDENCE_REPOSITORY + '/' + path;
    const authorization = 'Basic ' + Buffer.from(env.NEXUS_USER + ':' + env.NEXUS_PASSWORD).toString('base64');
    const res = await fetch(url, { method: 'PUT', headers: { authorization, 'content-type': 'application/json' }, body, signal: AbortSignal.timeout(60_000) });
    // The repository never overwrites (write policy "allow once"): a second
    // attempt for the same deployment finds its evidence already there.
    if (res.status === 400) {
        const existing = await fetch(url, { method: 'HEAD', headers: { authorization }, signal: AbortSignal.timeout(30_000) });
        if (existing.ok) return 'already stored';
    }
    // The file's name is enough: the reason goes into the GitHub status, which is short.
    if (!res.ok) throw new Error('Nexus answered ' + res.status + ' to storing ' + path.split('/').pop());
    return 'stored';
}

async function stepArchive() {
    try {
        if (!env.DEPLOY_NEXUS_URL || !env.NEXUS_USER || !env.NEXUS_PASSWORD) {
            throw new Error('no Nexus to store it in: DEPLOY_NEXUS_URL or the nexus-evidence credential is missing');
        }
        const evidence = {
            'sbom.cdx.json': verifiedPredicate('cyclonedx'),
            'vuln.json': verifiedPredicate('vuln'),
        };
        say('cosign verified the SBOM and the vulnerability report, both attested by ' + SIGNER + ' at ' + deployment.sha.slice(0, 12));
        evidence['deployment.json'] = {
            deployment: { id: Number(deployment.id), sha: deployment.sha, image: deployment.image, environment: deployment.environment },
            deployedBy: env.BUILD_URL ?? null,
            replaced: state.imageBefore ?? null,
            pods: state.pods ?? [],
            attestationsVerified: { identity: SIGNER, issuer: SIGNER_ISSUER, commit: deployment.sha },
            archivedAt: new Date().toISOString(),
        };
        const prefix = deployment.sha + '/' + deployment.id + '/';
        for (const [name, content] of Object.entries(evidence)) say(name + ': ' + await nexusPut(prefix + name, JSON.stringify(content, null, 2)));
        state.archived = EVIDENCE_REPOSITORY + '/' + prefix;
        save();
        say('the evidence is in Nexus: ' + state.archived);
    } catch (error) {
        state.archiveError = error.message;
        save();
        fail('evidence not archived: ' + error.message);
    }
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
        // Where visitors reach this environment: http://localhost/ on Kind,
        // the CloudFront address on EKS.
        environment_url: new URL(env.DEPLOY_EDGE_URL).protocol + '//' + env.DEPLOY_EDGE_HOST + '/',
    });
    say('reported to GitHub deployment ' + deployment.id + ': ' + status);
}

async function stepReport() {
    const result = env.BUILD_RESULT;
    if (state.superseded) return report('inactive', 'Superseded by deployment ' + state.superseded);
    if (result === 'SUCCESS') {
        // Why the evidence is missing, where anyone looking at the deployment
        // sees it; run 4 said only "NOT archived", and its log died with its runner (D-100).
        const evidence = state.archived ? '; evidence in Nexus' : state.archiveError ? '; evidence NOT archived: ' + state.archiveError : '';
        return report('success', 'Deployed ' + deployment.sha.slice(0, 12) + ' and checked through the edge' + evidence);
    }
    const outcome = state.rolledBack ? '; rolled back to ' + String(state.imageBefore).split('@').pop().slice(0, 19)
        : state.changed ? '; rollback did not complete' : '; nothing was changed';
    return report(result === 'ABORTED' ? 'error' : 'failure', 'Failed' + outcome);
}

const steps = { request: stepRequest, verify: stepVerify, deploy: stepDeploy, wait: stepWait, check: stepCheck, archive: stepArchive, rollback: stepRollback, report: stepReport };
const step = steps[process.argv[2]];
if (!step) fail('usage: node jenkins/deploy.mjs ' + Object.keys(steps).join('|'));
try {
    await step();
} catch (error) {
    fail(error.message);
}
