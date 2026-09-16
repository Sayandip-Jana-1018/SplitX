/**
 * A staircase of traffic, to watch the autoscaler climb and come back down.
 *
 * Arrival rate, not virtual users: requests keep arriving at the stated rate
 * however slow the responses get, the way real visitors do. A fixed pool of
 * users would slow down with the service and hide the overload it was meant
 * to create.
 *
 * 1,000-person plans cost about 24 ms of CPU. At the HPA's target of 60% of a
 * 250m request, each pod should settle at roughly 6 requests a second, so the
 * steps below ask for about 2, 5, 10 and then more pods than the maximum.
 */
import { preview, summarise } from './lib.js';

const MEMBERS = Number(__ENV.MEMBERS || 1000);
const STEP = __ENV.STEP || '2m';

export const STAGES = [
    { duration: '30s', target: 10 },
    { duration: STEP, target: 10 },
    { duration: '30s', target: 30 },
    { duration: STEP, target: 30 },
    { duration: '30s', target: 60 },
    { duration: STEP, target: 60 },
    { duration: '30s', target: 100 },
    { duration: STEP, target: 100 },
    { duration: '30s', target: 0 },
];

export const options = {
    noCookiesReset: true,
    scenarios: {
        staircase: {
            executor: 'ramping-arrival-rate',
            startRate: 2,
            timeUnit: '1s',
            preAllocatedVUs: 100,
            maxVUs: 600,
            stages: STAGES,
        },
    },
    summaryTrendStats: ['avg', 'p(50)', 'p(95)', 'p(99)', 'max'],
};

export default function climb() {
    preview(MEMBERS, { test: 'staircase' });
}

export function handleSummary(data) {
    return summarise(data, { test: 'staircase', members: MEMBERS, stages: STAGES });
}
