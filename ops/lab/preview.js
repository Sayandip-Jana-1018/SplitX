/**
 * The traffic lab's one test (D-097): settlement plans for 1,000-person
 * trips, the endpoint the autoscaler is driven by (as in load/staircase.js),
 * arriving at a constant rate however slowly they are answered, the way real
 * visitors keep arriving.
 *
 * TARGET, RATE and SECONDS come from the lab (lab/server.mjs), which takes
 * the target from its own configuration and checks the rest (lab/limits.mjs).
 */
import http from 'k6/http';
import { Counter } from 'k6/metrics';

const outcomes = {
    200: new Counter('preview_ok'),
    429: new Counter('preview_rate_limited'),
    503: new Counter('preview_shed'),
};
const other = new Counter('preview_other');

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
    const response = http.post(
        __ENV.TARGET + '/api/settlements/preview',
        JSON.stringify({ scenario: { members: 1000 } }),
        { headers: { 'content-type': 'application/json' }, tags: { name: 'preview' }, timeout: '20s' }
    );
    (outcomes[response.status] || other).add(1);
}

export function handleSummary(data) {
    return { [__ENV.SUMMARY]: JSON.stringify(data) };
}
