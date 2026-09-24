/**
 * The traffic lab's one test (D-097): settlement plans for 1,000-person
 * trips, the endpoint the autoscaler is driven by (as in load/staircase.js),
 * arriving at a constant rate however slowly they are answered, the way real
 * visitors keep arriving.
 *
 * Each plan is a visitor: a phone that opens /scale, the page a classroom
 * opens (D-048), and plans once. The app gives it its own device there, and
 * limits it as itself (60 plans a minute); all of them together stay under
 * their network's ceiling of 2,400 a minute (D-045). Without that first page,
 * every plan counted against the lab's one address at 60 a minute, and about
 * 29 of every 30 were refused before any pod did any work (D-100). k6 empties
 * the cookie jar after each iteration, so the next visitor is a new device.
 *
 * TARGET, RATE and SECONDS come from the lab (lab/server.mjs), which takes
 * the target from its own configuration and checks the rest (lab/limits.mjs).
 */
import http from 'k6/http';
import { Counter, Trend } from 'k6/metrics';

const outcomes = {
    200: new Counter('preview_ok'),
    429: new Counter('preview_rate_limited'),
    503: new Counter('preview_shed'),
};
const other = new Counter('preview_other');
// How long each plan took, apart from the page visit before it (lab/limits.mjs).
const planMs = new Trend('preview_ms', true);

export const options = {
    scenarios: {
        lab: {
            executor: 'constant-arrival-rate',
            rate: Number(__ENV.RATE),
            timeUnit: '1s',
            duration: __ENV.SECONDS + 's',
            preAllocatedVUs: 20,
            maxVUs: 200,
        },
    },
    summaryTrendStats: ['avg', 'p(50)', 'p(95)', 'max'],
};

export default function plan() {
    http.get(__ENV.TARGET + '/scale', { tags: { name: 'arrive' }, timeout: '20s' });
    const response = http.post(
        __ENV.TARGET + '/api/settlements/preview',
        JSON.stringify({ scenario: { members: 1000 } }),
        { headers: { 'content-type': 'application/json' }, tags: { name: 'preview' }, timeout: '20s' }
    );
    (outcomes[response.status] || other).add(1);
    planMs.add(response.timings.duration);
}

export function handleSummary(data) {
    return { [__ENV.SUMMARY]: JSON.stringify(data) };
}
