/**
 * A classroom trying the demo at once — with PRODUCTION rate limits.
 *
 * 80 students arrive over 30 seconds from one network address (a campus NAT)
 * and plan a trip every 4 to 8 seconds, the pace of someone tapping a button
 * and reading the result. One more device ignores the pace and plans as fast
 * as it can.
 *
 * What should happen: every student is served, and only the greedy device is
 * slowed down. What a per-address limiter does instead: 80 people share one
 * allowance, and nearly everyone is refused.
 */
import { sleep } from 'k6';
import { arrive, preview, summarise } from './lib.js';

const STUDENTS = Number(__ENV.STUDENTS || 80);
const HOLD = __ENV.HOLD || '2m';
const seconds = (duration) => (duration.endsWith('m') ? Number(duration.slice(0, -1)) * 60 : Number(duration.slice(0, -1)));
// The greedy device runs for as long as the students do: ramp up, hold, ramp down.
const GREEDY_DURATION = 40 + seconds(HOLD) + 's';

export const options = {
    // Browsers keep cookies between requests; k6 resets them per iteration unless told not to.
    noCookiesReset: true,
    scenarios: {
        students: {
            executor: 'ramping-vus',
            exec: 'student',
            startVUs: 0,
            stages: [
                { duration: '30s', target: STUDENTS },
                { duration: HOLD, target: STUDENTS },
                { duration: '10s', target: 0 },
            ],
            gracefulRampDown: '10s',
        },
        greedy: {
            executor: 'constant-vus',
            exec: 'greedy',
            vus: 1,
            duration: GREEDY_DURATION,
        },
    },
    summaryTrendStats: ['avg', 'p(50)', 'p(95)', 'p(99)', 'max'],
};

export function student() {
    if (__ITER === 0) arrive({ who: 'student' });
    preview(200 + Math.floor(Math.random() * 800), { who: 'student' });
    sleep(4 + Math.random() * 4);
}

export function greedy() {
    if (__ITER === 0) arrive({ who: 'greedy' });
    preview(500, { who: 'greedy' });
    sleep(0.25);
}

export function handleSummary(data) {
    return summarise(data, { test: 'classroom', students: STUDENTS, hold: HOLD });
}
