/**
 * A staircase of traffic, to watch the autoscaler climb and come back down.
 *
 * Arrival rate, not virtual users: requests keep arriving at the stated rate
 * however slow the responses get, the way real visitors do. A fixed pool of
 * users would slow down with the service and hide the overload it was meant
 * to create.
 *
 * Measured on the cluster (D-051), a 1,000-person plan costs 34 to 39 ms of CPU
 * for the whole request, 14 to 19 ms of it planning. At the HPA's target of 60%
 * of a 250m request each pod settles at about 4 plans a second, so the steps
 * below ask for about 3, 7, 15 and 26 pods: two within the maximum of 10, two
 * beyond it.
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
