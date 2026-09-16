/**
 * More work than the pods can do, held steady — to measure load shedding.
 *
 * The saturation overlay pins the deployment at two pods and lifts the rate
 * limits. 2,000-person plans cost about 57 ms of CPU each, so two pods of one
 * core each can serve roughly 35 a second; this sends 60. The backlog grows
 * until requests start waiting longer than PREVIEW_MAX_QUEUE_MS, and from then
 * on the question is what the requests that ARE served experience.
 */
import { preview, summarise } from './lib.js';

const RATE = Number(__ENV.RATE || 60);
const MEMBERS = Number(__ENV.MEMBERS || 2000);
const DURATION = __ENV.DURATION || '2m';

export const options = {
    noCookiesReset: true,
    scenarios: {
        overload: {
            executor: 'constant-arrival-rate',
            rate: RATE,
            timeUnit: '1s',
            duration: DURATION,
            preAllocatedVUs: 300,
            maxVUs: 1500,
        },
    },
    summaryTrendStats: ['avg', 'p(50)', 'p(95)', 'p(99)', 'max'],
};

export default function overload() {
    preview(MEMBERS, { test: 'saturation' });
}

export function handleSummary(data) {
    return summarise(data, { test: 'saturation', rate: RATE, members: MEMBERS, duration: DURATION });
}
