#!/usr/bin/env node
/**
 * The steps of kind-e2e.yml that talk to GitHub or write the run's .env
 * (D-099). Each prints what it did and never a value.
 *
 *   node scripts/e2e.mjs env                 write .env for this run: fresh passwords, and the
 *                                            repository's webhook channel, secret and token
 *   node scripts/e2e.mjs release [sha] [--wait]
 *                                            the signed release to run: the newest the release job
 *                                            announced, or the one for <sha>; --wait gives CI up to
 *                                            30 minutes to release it
 *   node scripts/e2e.mjs deliver             announce that release as a GitHub deployment for "kind",
 *                                            exactly as a merge does, and wait for Jenkins' verdict
 *   node scripts/e2e.mjs retire <id>         mark that deployment inactive: the runner's cluster is gone
 *   node scripts/e2e.mjs jenkins-logs <dir>  keep every Jenkins build's console in <dir>, with the evidence
 *
 * `release` and `deliver` write their results to $GITHUB_OUTPUT. GitHub is
 * read and written with GITHUB_TOKEN, the job's own token.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deliveryState, e2eEnvironment, envLine, OPTIONAL, pickRelease, relayVerdict } from './lib/e2e.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// The run's Jenkins password, for asking Jenkins how the delivery is going. Read, never printed.
if (['deliver', 'jenkins-logs'].includes(process.argv[2]) && existsSync(join(root, '.env'))) process.loadEnvFile(join(root, '.env'));
const REPOSITORY = process.env.GITHUB_REPOSITORY || 'Sayandip-Jana-1018/SplitX';
// Flags (--wait) are read where they apply; the rest are positional.
const [command, argument] = process.argv.slice(2).filter((value) => !value.startsWith('--'));

function fail(message) {
    console.error('x ' + message);
    process.exit(1);
}

function output(values) {
    for (const [key, value] of Object.entries(values)) {
        console.log('    ' + key + ' = ' + value);
        if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, key + '=' + value + '\n');
    }
}

async function github(method, path, body) {
    const token = process.env.GITHUB_TOKEN;
    if (!token) fail('GITHUB_TOKEN is not set');
    const response = await fetch('https://api.github.com/repos/' + REPOSITORY + path, {
        method,
        headers: {
            accept: 'application/vnd.github+json',
            authorization: 'Bearer ' + token,
            'x-github-api-version': '2022-11-28',
            'user-agent': 'splitx-kind-e2e',
            ...(body ? { 'content-type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
        const text = await response.text();
        fail('GitHub answered ' + response.status + ' to ' + method + ' ' + path + ': ' + text.slice(0, 200));
    }
    return response.json();
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** One GET to the cluster's Jenkins, through ingress-nginx, as a person with the admin password would ask. */
function jenkinsGet(path, timeoutMs = 10_000) {
    return new Promise((resolve) => {
        const auth = 'Basic ' + Buffer.from('admin:' + (process.env.JENKINS_ADMIN_PASSWORD ?? '')).toString('base64');
        const req = httpRequest({ host: '127.0.0.1', port: 80, path, headers: { Host: 'jenkins.localhost', Authorization: auth }, timeout: timeoutMs }, (res) => {
            let text = '';
            res.on('data', (chunk) => { text += chunk; });
            res.on('end', () => resolve({ status: res.statusCode, text }));
        });
        req.on('timeout', () => req.destroy(new Error('no answer in ' + timeoutMs / 1000 + ' s')));
        req.on('error', (error) => resolve({ status: 0, text: '', error: error.message }));
        req.end();
    });
}

/** The job's builds, newest first, or why Jenkins could not say. */
async function jenkinsBuildList(tree) {
    const answer = await jenkinsGet('/job/splitx-deploy/api/json?tree=' + encodeURIComponent(tree));
    if (answer.status === 0) return { builds: null, why: 'Jenkins could not be asked (' + answer.error + ')' };
    try {
        return { builds: JSON.parse(answer.text).builds ?? [], why: '' };
    } catch {
        return { builds: null, why: 'Jenkins answered HTTP ' + answer.status };
    }
}

/**
 * What the cluster's Jenkins is doing: Jenkins reports to GitHub only when a
 * build ends, so while waiting this tells "no delivery yet" from "deploying".
 */
async function jenkinsBuilds() {
    const { builds, why } = await jenkinsBuildList('builds[number,result,building]{0,3}');
    if (!builds) return why;
    return builds.length ? builds.map((b) => '#' + b.number + ' ' + (b.building ? 'running' : String(b.result).toLowerCase())).join(', ') : 'no build yet';
}

if (command === 'env') {
    if (existsSync(join(root, '.env'))) fail('.env already exists; this step only writes a fresh one on a runner');
    const { values, missing } = e2eEnvironment(process.env);
    if (missing.length) {
        // GitHub keeps secret names starting GITHUB_ for itself, so the webhook's
        // secret is stored as GIT_WEBHOOK_SECRET and kind-e2e.yml renames it.
        fail('this run has no ' + missing.join(', ') + '. They are the repository webhook\'s Payload URL and secret, the same '
            + 'values as SMEE_URL and GITHUB_WEBHOOK_SECRET in the owner\'s .env: add them as the Actions secrets SMEE_URL and GIT_WEBHOOK_SECRET.');
    }
    // Masked before anything is written: none of them can reach the log afterwards.
    if (process.env.GITHUB_ACTIONS === 'true') for (const value of Object.values(values)) console.log('::add-mask::' + value);
    const text = '# Written by scripts/e2e.mjs for one kind-e2e run; it lives and dies with the runner.\n'
        + Object.entries(values).map(([key, value]) => envLine(key, value)).join('\n') + '\n';
    writeFileSync(join(root, '.env'), text, { mode: 0o600 });
    const absent = OPTIONAL.filter((key) => !values[key]);
    console.log('.env written: ' + Object.keys(values).sort().join(', '));
    if (absent.length) console.log('    no ' + absent.join(', ') + ': alerts fire in the run but are not emailed');
} else if (command === 'release') {
    // --wait: a push starts this run and CI at once, and CI's release job
    // announces the commit's signed release some ten minutes later.
    const waitMinutes = process.argv.includes('--wait') ? 30 : 0;
    const until = Date.now() + waitMinutes * 60_000;
    let release = pickRelease(await github('GET', '/deployments?environment=kind&per_page=50'), argument ?? '');
    while (!release && Date.now() < until) {
        console.log('    waiting for CI to release ' + (argument || 'main') + '…');
        await sleep(30_000);
        release = pickRelease(await github('GET', '/deployments?environment=kind&per_page=50'), argument ?? '');
    }
    if (!release) {
        fail(argument
            ? 'no signed release of ' + argument + ' was announced to "kind"' + (waitMinutes ? ' in ' + waitMinutes + ' minutes' : '') + ' (only commits that pass CI on main have one)'
            : 'the release job has announced no signed release to "kind" yet');
    }
    console.log('The release to run');
    output({ sha: release.sha, image: release.image, ops_image: release.opsImage });
} else if (command === 'deliver') {
    const { RELEASE_SHA: sha, RELEASE_IMAGE: image, RELEASE_OPS_IMAGE: opsImage } = process.env;
    if (!sha || !image || !opsImage) fail('RELEASE_SHA, RELEASE_IMAGE and RELEASE_OPS_IMAGE must be set');
    // The same request the release job makes (ci.yml, "Ask Jenkins to deploy it").
    const deployment = await github('POST', '/deployments', {
        ref: sha,
        environment: 'kind',
        auto_merge: false,
        required_contexts: [],
        production_environment: false,
        transient_environment: true,
        description: 'Signed release, on the kind-e2e runner',
        payload: { image, ops_image: opsImage },
    });
    console.log('deployment ' + deployment.id + ' of ' + sha.slice(0, 12) + ' announced to "kind"; GitHub now sends it to the webhook');
    output({ deployment: deployment.id });

    // Jenkins starts within seconds of the delivery; a deploy with its checks
    // takes 3 to 5 minutes. Twenty minutes means something is wrong.
    const started = Date.now();
    let last = '';
    while (Date.now() - started < 20 * 60_000) {
        const state = deliveryState(await github('GET', '/deployments/' + deployment.id + '/statuses?per_page=5'));
        // The relay's log since the deployment was made: a refused delivery ends the wait at once.
        const relay = relayVerdict(spawnSync('kubectl', ['--context', 'kind-splitx', '-n', 'jenkins', 'logs', 'deployment/webhook-relay', '--since-time=' + deployment.created_at],
            { encoding: 'utf8', timeout: 20_000 }).stdout ?? '');
        if (relay.refused && !state.done) fail('GitHub\'s delivery reached the cluster, but ' + relay.said);
        const line = state.state + (state.said ? ': ' + state.said : '') + (state.done ? '' : '; relay: ' + relay.said + '; Jenkins: ' + await jenkinsBuilds());
        if (line !== last) console.log('    ' + Math.round((Date.now() - started) / 1000) + ' s  ' + line);
        last = line;
        if (state.done) {
            if (!state.ok) fail('Jenkins reported ' + line);
            console.log('Jenkins delivered it in ' + Math.round((Date.now() - started) / 1000) + ' s');
            process.exit(0);
        }
        await sleep(10_000);
    }
    fail('no verdict from Jenkins in 20 minutes; last: ' + last);
} else if (command === 'retire') {
    if (!/^\d+$/.test(argument ?? '')) fail('usage: node scripts/e2e.mjs retire <deployment id>');
    await github('POST', '/deployments/' + argument + '/statuses', {
        state: 'inactive',
        description: 'The kind-e2e run ended, and its cluster with it',
    });
    console.log('deployment ' + argument + ' marked inactive');
} else if (command === 'jenkins-logs') {
    // Every build's console, as Jenkins kept it: each delivery and rollback of
    // the run, step by step. Jenkins ends with the runner, and a deployment's
    // status holds a line at most (D-100). Evidence, so it never fails the run.
    if (!argument) fail('usage: node scripts/e2e.mjs jenkins-logs <directory>');
    const { builds, why } = await jenkinsBuildList('builds[number,result]');
    if (!builds) {
        console.log('No build logs kept: ' + why);
        process.exit(0);
    }
    if (!builds.length) console.log('Jenkins has no build to keep: no delivery reached it');
    mkdirSync(argument, { recursive: true });
    for (const build of [...builds].reverse()) {
        const log = await jenkinsGet('/job/splitx-deploy/' + build.number + '/consoleText', 30_000);
        const file = join(argument, 'jenkins-build-' + build.number + '.txt');
        writeFileSync(file, log.status === 200 ? log.text : 'Jenkins answered HTTP ' + log.status + (log.error ? ' (' + log.error + ')' : '') + '\n');
        console.log('    #' + build.number + ' ' + String(build.result ?? 'running').toLowerCase() + ': ' + log.text.split('\n').length + ' lines, in ' + file);
    }
} else {
    fail('usage: node scripts/e2e.mjs env | release [sha] [--wait] | deliver | retire <id> | jenkins-logs <dir>');
}
