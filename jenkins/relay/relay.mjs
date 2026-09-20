#!/usr/bin/env node
/**
 * GitHub → smee.io → this relay → Jenkins (D-056).
 *
 * GitHub cannot reach a Jenkins on a laptop, so the repository's webhook
 * posts to a smee.io channel. This process, inside the cluster, holds that
 * channel's event stream open and replays every delivery to Jenkins with
 * GitHub's own headers, the signature included. It adds no trust of its own:
 * Jenkins checks the signature with a secret this process never holds, so a
 * delivery that did not come from GitHub, or was changed on the way, is
 * refused there. On AWS, GitHub calls Jenkins directly and this is not run.
 *
 * smee.io hands a delivery over as parsed JSON, so the body is rebuilt with
 * JSON.stringify. The signature still verifies when GitHub's bytes are what
 * JSON.stringify writes: compact, characters unescaped, no number that
 * changes when parsed. D-056 records what was measured.
 *
 *   SMEE_URL        the channel, https://smee.io/<id>
 *   TARGET_URL      Jenkins' endpoint, .../generic-webhook-trigger/invoke
 *   TRIGGER_TOKEN   the endpoint's token
 *   PORT            metrics and health checks (default 9090)
 *
 * No dependencies: it runs from a ConfigMap on the pinned Node image.
 */
import { createServer } from 'node:http';

const SMEE_URL = required('SMEE_URL');
const TARGET_URL = required('TARGET_URL');
const TRIGGER_TOKEN = required('TRIGGER_TOKEN');
const PORT = Number(process.env.PORT ?? 9090);
// smee.io sends a ping every 30 s; two missed pings means the stream is dead
// even if the connection still looks open.
const IDLE_MS = 75_000;
// GitHub's headers worth passing on. The rest describe the hop to smee.io.
const FORWARD = [
    'user-agent', 'x-github-event', 'x-github-delivery', 'x-github-hook-id',
    'x-github-hook-installation-target-id', 'x-github-hook-installation-target-type',
    'x-hub-signature', 'x-hub-signature-256',
];

const metrics = {
    // Every result starts at 0. A counter that first appears at 1 shows no
    // increase to Prometheus, and the first refused delivery would not alert.
    deliveries: { accepted: 0, refused: 0, unreachable: 0 },
    connected: 0,
    reconnects: 0,
    lastMessage: 0,
};

function required(name) {
    const value = process.env[name];
    if (!value) {
        log('error', 'missing environment variable', { name });
        process.exit(1);
    }
    return value;
}

function log(level, msg, fields = {}) {
    process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), level, msg, service: 'webhook-relay', ...fields }) + '\n');
}

async function relay(delivery) {
    const headers = { 'content-type': 'application/json', token: TRIGGER_TOKEN };
    for (const name of FORWARD) if (typeof delivery[name] === 'string') headers[name] = delivery[name];
    const event = headers['x-github-event'] ?? 'unknown';
    if (!String(delivery['content-type'] ?? '').startsWith('application/json')) {
        // A form-encoded delivery cannot be rebuilt byte for byte, so its signature would fail.
        log('warn', 'the webhook must send application/json', { event, contentType: delivery['content-type'] });
    }
    let status = 0;
    try {
        const res = await fetch(TARGET_URL, {
            method: 'POST',
            headers,
            body: JSON.stringify(delivery.body),
            signal: AbortSignal.timeout(30_000),
        });
        status = res.status;
        // Read and dropped: a refusal echoes the request headers, signature included.
        await res.text();
    } catch (error) {
        log('error', 'could not reach Jenkins', { event, delivery: headers['x-github-delivery'], error: String(error.cause ?? error) });
    }
    // Accepted: the signature and token verified (Jenkins then decides whether
    // the event starts a build). Refused: any other answer, 403 for a signature
    // that did not verify.
    const result = status === 0 ? 'unreachable' : status >= 200 && status < 300 ? 'accepted' : 'refused';
    metrics.deliveries[result] += 1;
    log(result === 'accepted' ? 'info' : 'warn', 'delivery relayed', { event, delivery: headers['x-github-delivery'], status, result });
}

// One connection to the channel: resolves when the stream ends or stalls.
async function follow() {
    const controller = new AbortController();
    let watchdog;
    const arm = () => {
        clearTimeout(watchdog);
        watchdog = setTimeout(() => controller.abort(new Error('no ping for ' + IDLE_MS / 1000 + ' s')), IDLE_MS);
    };
    try {
        arm();
        const res = await fetch(SMEE_URL, { headers: { Accept: 'text/event-stream' }, signal: controller.signal });
        if (!res.ok) throw new Error('smee.io answered HTTP ' + res.status);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
            const { value, done } = await reader.read();
            if (done) throw new Error('the stream ended');
            arm();
            buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
            let cut;
            while ((cut = buffer.indexOf('\n\n')) >= 0) {
                const block = buffer.slice(0, cut);
                buffer = buffer.slice(cut + 2);
                let type = 'message';
                const data = [];
                for (const line of block.split('\n')) {
                    if (line.startsWith('event:')) type = line.slice(6).trim();
                    else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
                }
                metrics.lastMessage = Date.now() / 1000;
                if (type === 'ready') {
                    metrics.connected = 1;
                    // The channel's address stays out of the logs: anyone who has it can read the stream.
                    log('info', 'listening on the smee.io channel');
                } else if (type === 'message' && data.length) {
                    let delivery;
                    try {
                        delivery = JSON.parse(data.join('\n'));
                    } catch {
                        log('warn', 'unreadable event on the channel');
                        continue;
                    }
                    await relay(delivery);
                }
            }
        }
    } catch (error) {
        if (!shuttingDown) log('warn', 'stream lost', { error: String(controller.signal.reason ?? error.cause ?? error) });
    } finally {
        clearTimeout(watchdog);
        metrics.connected = 0;
        controller.abort();
    }
}

const server = createServer((req, res) => {
    if (req.url === '/metrics') {
        const lines = [
            '# HELP webhook_relay_deliveries_total Deliveries replayed to Jenkins, by result: accepted (2xx), refused (any other status), unreachable.',
            '# TYPE webhook_relay_deliveries_total counter',
            ...Object.entries(metrics.deliveries).map(([result, count]) => 'webhook_relay_deliveries_total{result="' + result + '"} ' + count),
            '# HELP webhook_relay_connected Whether the relay holds the smee.io stream open.',
            '# TYPE webhook_relay_connected gauge',
            'webhook_relay_connected ' + metrics.connected,
            '# HELP webhook_relay_reconnects_total Times the stream was opened again.',
            '# TYPE webhook_relay_reconnects_total counter',
            'webhook_relay_reconnects_total ' + metrics.reconnects,
            '# HELP webhook_relay_last_message_timestamp_seconds When smee.io last sent anything, pings included.',
            '# TYPE webhook_relay_last_message_timestamp_seconds gauge',
            'webhook_relay_last_message_timestamp_seconds ' + metrics.lastMessage,
        ];
        res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4' }).end(lines.join('\n') + '\n');
    } else if (req.url === '/healthz') {
        res.writeHead(200).end('ok\n');
    } else {
        res.writeHead(404).end();
    }
});

let shuttingDown = false;
process.on('SIGTERM', () => {
    shuttingDown = true;
    log('info', 'stopping');
    server.close();
    process.exit(0);
});

server.listen(PORT, () => log('info', 'metrics and health on :' + PORT));

let backoff = 1_000;
for (;;) {
    const started = Date.now();
    await follow();
    if (shuttingDown) break;
    // A connection that lasted resets the wait; one that failed at once backs off.
    backoff = Date.now() - started > 60_000 ? 1_000 : Math.min(backoff * 2, 30_000);
    metrics.reconnects += 1;
    await new Promise((resolve) => setTimeout(resolve, backoff));
}
