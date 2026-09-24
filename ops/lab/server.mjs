#!/usr/bin/env node
/**
 * The traffic lab (D-097): a button on /ops that sends real load at SplitX,
 * so the audience can watch the autoscaler add pods (and a node) and take
 * them away again. It holds no credentials and has one fixed target.
 *
 *   GET    /v1/run    what it is doing: idle, running, or how the last run went
 *   POST   /v1/run    start a run: { rate, seconds } within lab/limits.mjs; one at a time
 *   DELETE /v1/run    stop the run
 *   GET    /healthz   for the kubelet
 *
 * Only ops-api may reach it (k8s/ops/networkpolicy.yaml). The load itself is
 * k6 (lab/preview.js) against TARGET_URL: the edge, the way visitors arrive,
 * on EKS; ingress-nginx on Kind.
 */
import { spawn } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRun, summariseK6 } from './limits.mjs';

const PORT = Number(process.env.PORT ?? 8080);
const TARGET = process.env.TARGET_URL ?? '';
const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'preview.js');
const SUMMARY = '/tmp/k6-summary.json';

if (!/^https?:\/\/[a-z0-9.-]+(:\d+)?$/i.test(TARGET)) {
    console.error('x TARGET_URL must be an http(s) origin, not "' + TARGET + '"');
    process.exit(1);
}

const log = (fields) => process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), service: 'traffic-lab', ...fields }) + '\n');

/** The current or last run; the child process itself is kept out of what is shown. */
let run = null;
let child = null;

function status() {
    if (!run) return { state: 'idle', target: TARGET };
    const elapsed = Math.round(((run.finishedAt ? Date.parse(run.finishedAt) : Date.now()) - Date.parse(run.startedAt)) / 1000);
    return { ...run, elapsedSeconds: elapsed, target: TARGET };
}

async function start(settings) {
    await rm(SUMMARY, { force: true });
    run = { state: 'running', rate: settings.rate, seconds: settings.seconds, startedAt: new Date().toISOString(), finishedAt: null, summary: null, error: null };
    let tail = '';
    let ended = false;
    // Once per run, whichever comes first: k6 closing, or k6 failing to start
    // (an 'error' nobody listens to would end the lab itself).
    const finish = async (code, signal, failure) => {
        if (ended) return;
        ended = true;
        const summary = await readFile(SUMMARY, 'utf8').then((text) => summariseK6(JSON.parse(text))).catch(() => null);
        const stopped = run.state === 'stopping';
        run = {
            ...run,
            state: stopped ? 'stopped' : code === 0 ? 'finished' : 'failed',
            finishedAt: new Date().toISOString(),
            summary,
            error: code === 0 || stopped ? null : failure ?? 'k6 exited ' + (code ?? signal) + ': ' + tail.trim().split('\n').slice(-3).join(' | '),
        };
        child = null;
        log({ msg: 'run ended', ...status() });
    };
    child = spawn('k6', ['run', '--quiet', '--no-color', SCRIPT], {
        env: { PATH: process.env.PATH, HOME: '/tmp', TARGET, RATE: String(settings.rate), SECONDS: String(settings.seconds), SUMMARY },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    const keep = (chunk) => { tail = (tail + chunk).slice(-2000); };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    child.on('error', (error) => finish(null, null, 'k6 could not run: ' + error.message));
    child.on('close', (code, signal) => finish(code, signal));
    log({ msg: 'run started', rate: settings.rate, seconds: settings.seconds });
}

async function readBody(req) {
    let text = '';
    for await (const chunk of req) {
        text += chunk;
        if (text.length > 1024) throw new RangeError('the body must be at most 1 KB');
    }
    return text ? JSON.parse(text) : {};
}

function send(res, code, value) {
    res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(value));
}

const server = createServer(async (req, res) => {
    const path = new URL(req.url ?? '/', 'http://lab').pathname;
    try {
        if (req.method === 'GET' && path === '/healthz') return send(res, 200, { ok: true });
        if (path !== '/v1/run') return send(res, 404, { error: 'not here' });
        if (req.method === 'GET') return send(res, 200, status());
        if (req.method === 'POST') {
            if (child) return send(res, 409, { error: 'a run is already going; stop it first', ...status() });
            let settings;
            try {
                settings = parseRun(await readBody(req));
            } catch (error) {
                return send(res, 400, { error: error instanceof RangeError ? error.message : 'the body must be JSON' });
            }
            await start(settings);
            return send(res, 202, status());
        }
        if (req.method === 'DELETE') {
            if (!child) return send(res, 409, { error: 'no run is going', ...status() });
            run.state = 'stopping';
            // k6 stops the scenario on SIGINT and still writes its summary.
            child.kill('SIGINT');
            return send(res, 202, status());
        }
        return send(res, 405, { error: 'GET, POST or DELETE' });
    } catch (error) {
        return send(res, 500, { error: error.message });
    }
});

server.listen(PORT, () => log({ msg: 'listening', port: PORT, target: TARGET }));
for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, () => {
        child?.kill('SIGINT');
        server.close(() => process.exit(0));
    });
}
