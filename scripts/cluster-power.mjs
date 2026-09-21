#!/usr/bin/env node
/**
 * Puts the rehearsal cluster to sleep without deleting anything, and wakes it.
 *
 *   node scripts/cluster-power.mjs pause    stop the three node containers
 *   node scripts/cluster-power.mjs resume   start them, and wait until the
 *                                           application answers at the edge
 *
 * The cluster is a showcase on a laptop, not a service: it has to run while it
 * is being shown or checked, not all day. Kind gives its nodes the restart
 * policy on-failure, and Docker Desktop's shutdown counts as a failure, so the
 * whole cluster cold-started every time Docker did — about 4.5 GB in a VM that
 * Windows then had to page, and every controller starting at once (D-062).
 * A node stopped with `docker stop` stays stopped, across Docker and Windows
 * restarts, until it is started here. Volumes, images, the database and
 * Jenkins' history are kept; nothing is re-created.
 *
 * While it sleeps, GitHub's deliveries to the smee.io channel are lost (smee.io
 * keeps nothing for a listener that is away), so a release merged meanwhile is
 * deployed by replaying its build in Jenkins once the cluster is back.
 */
import { spawnSync } from 'node:child_process';
import { request } from 'node:http';

const CLUSTER = 'splitx';
const CONTEXT = 'kind-' + CLUSTER;
const NODES = [CLUSTER + '-control-plane', CLUSTER + '-worker', CLUSTER + '-worker2'];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const seconds = (since) => Math.round((Date.now() - since) / 1000);

function fail(message) {
    console.error('x ' + message);
    process.exit(1);
}

function run(file, argv, { allowFailure = false } = {}) {
    const result = spawnSync(file, argv, { encoding: 'utf8', shell: false });
    if (result.error) fail('could not run ' + file + ': ' + result.error.message);
    if (result.status !== 0 && !allowFailure) fail((result.stderr || result.stdout || file + ' exited ' + result.status).trim());
    return { code: result.status, stdout: (result.stdout ?? '').trim() };
}
const kubectl = (argv) => run('kubectl', ['--context', CONTEXT, ...argv], { allowFailure: true });
const states = () => NODES.map((node) => run('docker', ['inspect', node, '--format', '{{.State.Status}}'], { allowFailure: true }).stdout || 'missing');

async function until(what, check, limit) {
    const started = Date.now();
    while (seconds(started) < limit) {
        if (await check()) return;
        await sleep(3000);
    }
    fail(what + ' within ' + limit + ' s');
}

// What a visitor gets from the edge, asked the way the verification scripts ask.
const edge = () => new Promise((resolve) => {
    const req = request({ host: '127.0.0.1', port: 80, path: '/api/health/live', headers: { Host: 'localhost' }, timeout: 5000 }, (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
    });
    req.on('timeout', () => {
        req.destroy();
        resolve(0);
    });
    req.on('error', () => resolve(0));
    req.end();
});

const action = process.argv[2];
const before = states();
if (before.includes('missing')) fail('the cluster "' + CLUSTER + '" does not exist; npm run k8s:up creates it');

if (action === 'pause') {
    if (before.every((state) => state === 'exited')) {
        console.log('already asleep; npm run k8s:resume wakes it');
        process.exit(0);
    }
    const started = Date.now();
    // The nodes stop on SIGRTMIN+3, which systemd takes as an orderly shutdown:
    // it stops every pod's scope, so Postgres and etcd shut down rather than
    // being killed. Each node gets a minute. The control plane has reached it
    // in systemd's very last step, with its pods, etcd included, stopped in
    // the first ten seconds; Docker then ends what is left.
    run('docker', ['stop', '--time', '60', ...NODES]);
    for (const node of NODES) {
        const code = run('docker', ['inspect', node, '--format', '{{.State.ExitCode}}']).stdout;
        console.log('    ' + node + ': ' + (code === '137' ? 'ended at the 60 s ceiling' : 'stopped in order'));
    }
    console.log('asleep after ' + seconds(started) + ' s, everything kept; npm run k8s:resume wakes it');
} else if (action === 'resume') {
    const started = Date.now();
    run('docker', ['start', ...NODES]);
    console.log('nodes started; waiting for the API server');
    await until('the API server did not answer', () => kubectl(['get', '--raw', '/readyz']).code === 0, 240);
    console.log('    API server ready after ' + seconds(started) + ' s');
    await until('the nodes did not all become Ready', () => {
        const ready = kubectl(['get', 'nodes', '-o', 'jsonpath={.items[*].status.conditions[?(@.type=="Ready")].status}']).stdout.split(' ');
        return ready.length === NODES.length && ready.every((status) => status === 'True');
    }, 240);
    console.log('    nodes Ready after ' + seconds(started) + ' s');
    // A pod's status can still say Ready from before the nodes stopped, so only
    // a container started since this resume, and ready since, counts.
    await until('the application pods did not come back ready', () => {
        const listed = kubectl(['-n', 'splitx', 'get', 'pods', '-l', 'app.kubernetes.io/name=splitx', '-o', 'json']);
        if (listed.code !== 0) return false;
        const pods = JSON.parse(listed.stdout).items.filter((pod) => !pod.metadata.deletionTimestamp);
        return pods.length > 0 && pods.every((pod) => {
            const app = pod.status.containerStatuses?.find((c) => c.name === 'splitx');
            return app?.ready === true && Date.parse(app.state?.running?.startedAt ?? 0) >= started - 1000;
        });
    }, 600);
    console.log('    application pods ready after ' + seconds(started) + ' s');
    await until('the edge did not answer 200', async () => (await edge()) === 200, 120);
    console.log('awake after ' + seconds(started) + ' s: the application answers at http://localhost');
} else {
    fail('usage: node scripts/cluster-power.mjs pause|resume');
}
