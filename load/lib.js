/**
 * Shared by every SplitX load test.
 *
 * Tests run in the official k6 container (scripts/load-run.mjs), so BASE_URL
 * defaults to the Windows host as seen from inside Docker: port 80 there is
 * the Kind cluster's ingress-nginx. Every request from k6 therefore arrives
 * from one network address — which is exactly the situation of a classroom
 * behind one campus NAT.
 */
import http from 'k6/http';
import { Counter, Trend } from 'k6/metrics';

export const BASE_URL = __ENV.BASE_URL || 'http://host.docker.internal';

const outcomes = {
    200: new Counter('preview_ok'),
    429: new Counter('preview_rate_limited'),
    503: new Counter('preview_shed'),
};
const otherOutcome = new Counter('preview_other');
const computeMs = new Trend('preview_compute_ms', true);
const servedBy = new Counter('preview_served_by');

/** A page navigation, the way a phone arrives: this is where a device cookie is set. */
export function arrive(tags = {}) {
    return http.get(BASE_URL + '/', { tags: { name: 'arrive', ...tags } });
}

/**
 * What the kubelet's liveness probe experiences: the same endpoint, waiting on
 * the same event loop. A long timeout so latencies past the probe's own timeout
 * are measured rather than cut off.
 */
export function live(tags = {}) {
    return http.get(BASE_URL + '/api/health/live', { tags: { name: 'live', ...tags }, timeout: '15s' });
}

/** Plans a simulated trip — the endpoint the autoscaler is driven by. */
export function preview(members, tags = {}) {
    const response = http.post(
        BASE_URL + '/api/settlements/preview',
        JSON.stringify({ scenario: { members } }),
        { headers: { 'content-type': 'application/json' }, tags: { name: 'preview', ...tags } }
    );
    const counter = outcomes[response.status] || otherOutcome;
    counter.add(1, tags);
    if (response.status === 200) {
        const body = response.json();
        computeMs.add(body.data.computeMs, tags);
        if (body.data.servedBy) servedBy.add(1, { ...tags, pod: body.data.servedBy });
    }
    return response;
}

/** Writes the full summary for the runner, plus one line for the console. */
export function summarise(data, extra = {}) {
    const count = (name) => (data.metrics[name] ? data.metrics[name].values.count : 0);
    const line = 'preview: ' + count('preview_ok') + ' ok, ' + count('preview_rate_limited') + ' rate limited, '
        + count('preview_shed') + ' shed, ' + count('preview_other') + ' other\n';
    return {
        '/out/summary.json': JSON.stringify({ ...data, extra }, null, 2),
        stdout: line,
    };
}
