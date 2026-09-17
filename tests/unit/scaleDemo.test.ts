import { describe, expect, it } from 'vitest';
import { clampMembers, nextDelayMs, podLabel, readOutcome, type Outcome } from '@/lib/scaleDemo';

const planned = (servedBy: string | null = 'splitx-7d9f8c6b5-x2kqp') => ({
    success: true,
    data: {
        mode: 'scenario',
        scenario: { members: 1000, seed: 42, expenses: 3000, totalSpent: 842_130_000 },
        summary: { people: 1000, transfers: 961, greedyTransfers: 999, directTransfers: 11_808 },
        computeMs: 17.2,
        servedBy,
    },
});

describe('readOutcome', () => {
    it('reads a plan, including which pod answered', () => {
        expect(readOutcome(200, planned(), null, 41.6)).toEqual({
            kind: 'planned',
            plan: {
                people: 1000,
                expenses: 3000,
                totalSpentPaise: 842_130_000,
                payments: 961,
                greedyPayments: 999,
                directIous: 11_808,
                computeMs: 17.2,
                roundTripMs: 42,
                pod: 'splitx-7d9f8c6b5-x2kqp',
                seed: 42,
            },
        });
    });

    it('reports no pod outside Kubernetes', () => {
        const outcome = readOutcome(200, planned(null), null, 10);
        expect(outcome.kind === 'planned' ? outcome.plan.pod : 'not planned').toBeNull();
    });

    it('takes the wait from Retry-After on busy and rate-limited answers', () => {
        expect(readOutcome(503, null, '1', 5)).toEqual({ kind: 'busy', retryAfterSeconds: 1 });
        expect(readOutcome(429, null, '37', 5)).toEqual({ kind: 'limited', retryAfterSeconds: 37 });
    });

    it('never waits zero, negative, absurd or unparseable Retry-After values', () => {
        expect(readOutcome(429, null, '0', 5)).toEqual({ kind: 'limited', retryAfterSeconds: 1 });
        expect(readOutcome(429, null, 'soon', 5)).toEqual({ kind: 'limited', retryAfterSeconds: 1 });
        expect(readOutcome(429, null, '100000', 5)).toEqual({ kind: 'limited', retryAfterSeconds: 120 });
    });

    it('treats anything else, or a 200 without a plan, as a failure', () => {
        expect(readOutcome(500, { success: false }, null, 5)).toEqual({ kind: 'failed', status: 500 });
        expect(readOutcome(200, { success: true, data: {} }, null, 5)).toEqual({ kind: 'failed', status: 200 });
        expect(readOutcome(200, null, null, 5)).toEqual({ kind: 'failed', status: 200 });
    });
});

describe('nextDelayMs', () => {
    const fixed = (value: number) => () => value;
    const plan = readOutcome(200, planned(), null, 10);
    const busy: Outcome = { kind: 'busy', retryAfterSeconds: 1 };
    const failed: Outcome = { kind: 'failed', status: 502 };

    it('plans about every four seconds, spread between three and five', () => {
        expect(nextDelayMs(plan, 0, fixed(0))).toBe(3_000);
        expect(nextDelayMs(plan, 0, fixed(0.5))).toBe(4_000);
        expect(nextDelayMs(plan, 0, fixed(1))).toBe(5_000);
    });

    it('spreads a classroom of phones out instead of firing them together', () => {
        const delays = new Set(Array.from({ length: 80 }, () => nextDelayMs(plan, 0)));
        expect(delays.size).toBeGreaterThan(60);
    });

    it('backs off exponentially while the service stays busy, and caps it', () => {
        expect(nextDelayMs(busy, 1, fixed(0.5))).toBe(1_000);
        expect(nextDelayMs(busy, 2, fixed(0.5))).toBe(2_000);
        expect(nextDelayMs(busy, 3, fixed(0.5))).toBe(4_000);
        expect(nextDelayMs(busy, 4, fixed(0.5))).toBe(8_000);
        expect(nextDelayMs(busy, 9, fixed(0.5))).toBe(8_000);
    });

    it('never retries a busy answer sooner than Retry-After, whatever the jitter', () => {
        for (const r of [0, 0.25, 0.5, 0.75, 1]) {
            expect(nextDelayMs(busy, 1, fixed(r))).toBeGreaterThanOrEqual(1_000);
        }
    });

    it('waits out a rate limit as long as the server said, plus jitter', () => {
        expect(nextDelayMs({ kind: 'limited', retryAfterSeconds: 12 }, 0, fixed(0.5))).toBe(12_000);
        expect(nextDelayMs({ kind: 'limited', retryAfterSeconds: 12 }, 0, fixed(0))).toBe(13_000);
    });

    it('slows down after repeated failures', () => {
        expect(nextDelayMs(failed, 1, fixed(0.5))).toBe(4_000);
        expect(nextDelayMs(failed, 3, fixed(0.5))).toBe(16_000);
    });
});

describe('clampMembers and podLabel', () => {
    it('keeps group sizes to what the API accepts, in steps of a hundred', () => {
        expect(clampMembers(1_234)).toBe(1_200);
        expect(clampMembers(5)).toBe(100);
        expect(clampMembers(99_999)).toBe(2_000);
        expect(clampMembers(Number.NaN)).toBe(1_000);
    });

    it('shows the distinguishing end of a pod name', () => {
        expect(podLabel('splitx-7d9f8c6b5-x2kqp')).toBe('x2kqp');
        expect(podLabel(null)).toBe('SplitX');
        expect(podLabel('standalone')).toBe('standalone');
    });
});
