import { describe, expect, it } from 'vitest';
import {
    duration,
    failedConditions,
    gateLabel,
    imageParts,
    platformLabel,
    sentence,
    severityTone,
    stateLabel,
    tally,
    toneOf,
    uniqueKeys,
    worstFirst,
} from '@/lib/ops/present';

describe('how /ops words and colours what its sources say', () => {
    it("colours GitHub's and SonarQube Cloud's states, and leaves anything else neutral", () => {
        expect(['success', 'OK'].map(toneOf)).toEqual(['success', 'success']);
        expect(['failure', 'error', 'ERROR', 'timed_out'].map(toneOf)).toEqual(['danger', 'danger', 'danger', 'danger']);
        expect(['in_progress', 'queued', 'pending', 'waiting'].map(toneOf)).toEqual(['warning', 'warning', 'warning', 'warning']);
        expect(['skipped', 'cancelled', 'NONE', 'constructor', '', null, undefined].map(toneOf)).toEqual(Array(7).fill('neutral'));
    });

    it('says a state in words, and says so when nobody has reported yet', () => {
        expect(stateLabel('in_progress')).toBe('in progress');
        expect(stateLabel('timed_out')).toBe('timed out');
        expect(stateLabel(null)).toBe('no report yet');
    });

    it('gives durations the way a person reads them', () => {
        expect(duration(null)).toBe('—');
        expect(duration(7)).toBe('7 s');
        expect(duration(151)).toBe('2 min 31 s');
    });

    it("sums up a run's jobs by outcome, worst first", () => {
        const jobs = [
            { status: 'completed', conclusion: 'success' },
            { status: 'completed', conclusion: 'skipped' },
            { status: 'completed', conclusion: 'success' },
            { status: 'completed', conclusion: 'failure' },
            { status: 'in_progress', conclusion: null },
            { status: 'queued', conclusion: null },
            { status: 'completed', conclusion: 'neutral' },
        ];
        expect(tally(jobs)).toBe('1 failed, 1 running, 1 queued, 2 passed, 1 skipped, 1 neutral');
        expect(tally([])).toBe('');
    });

    it('orders alert severities worst first, unknown ones last, and colours them', () => {
        expect(worstFirst({ low: 1, odd: 2, critical: 3, medium: 4 })).toEqual([['critical', 3], ['medium', 4], ['low', 1], ['odd', 2]]);
        expect(['critical', 'high', 'error'].map(severityTone)).toEqual(['danger', 'danger', 'danger']);
        expect(['medium', 'moderate', 'warning'].map(severityTone)).toEqual(['warning', 'warning', 'warning']);
        expect(['low', 'note'].map(severityTone)).toEqual(['neutral', 'neutral']);
    });
});

describe("SonarQube Cloud's verdict", () => {
    it('is worded, including a project that has no verdict yet', () => {
        expect(gateLabel('OK')).toBe('gate passed');
        expect(gateLabel('ERROR')).toBe('gate failed');
        expect(gateLabel('NONE')).toBe('no verdict yet');
        expect(gateLabel('WARN')).toBe('gate warn');
    });

    it('says which conditions failed, with the value and what the gate wants', () => {
        expect(failedConditions([
            { metric: 'new_coverage', status: 'ERROR', comparator: 'LT', actual: '72.44', threshold: '80' },
            { metric: 'new_reliability_rating', status: 'ERROR', comparator: 'GT', actual: '3', threshold: '1' },
            { metric: 'new_maintainability_rating', status: 'ERROR', comparator: 'GT', actual: '4', threshold: '2' },
            { metric: 'new_duplicated_lines_density', status: 'ERROR', comparator: 'GT', actual: '4.2', threshold: '3' },
            { metric: 'new_duplicated_lines_density', status: 'OK', comparator: 'GT', actual: '0.0', threshold: '3' },
            { metric: 'new_violations', status: 'ERROR', comparator: 'GT', actual: '4', threshold: '0' },
            { metric: 'new_lines', status: 'ERROR', comparator: null, actual: '12', threshold: '10' },
            { metric: 'new_security_rating', status: 'ERROR', comparator: 'GT', actual: null, threshold: '1' },
        ])).toEqual([
            'coverage of new code 72.4 % (the gate wants at least 80.0 %)',
            'reliability of new code C (the gate wants A)',
            'maintainability of new code D (the gate wants B or better)',
            'duplication in new code 4.2 % (the gate wants at most 3.0 %)',
            'new violations 4 (the gate wants at most 0)',
            'new lines 12 (the gate wants 10)',
        ]);
    });
});

describe('small print', () => {
    it('ends a reason as a sentence, once', () => {
        expect(sentence('ops-api could not be reached (ECONNREFUSED)')).toBe('ops-api could not be reached (ECONNREFUSED).');
        expect(sentence('Not connected here: the cluster runs on AWS on demo days, and on Kind in CI. ')).toBe('Not connected here: the cluster runs on AWS on demo days, and on Kind in CI.');
    });

    it('names the platform, or passes an unknown one through', () => {
        expect([platformLabel('eks'), platformLabel('kind'), platformLabel('k3s')]).toEqual(['Amazon EKS', 'Kind', 'k3s']);
    });

    it('keys repeated list items apart, and leaves unique ones alone', () => {
        expect(uniqueKeys(['a', 'b', 'a', 'a'], (item) => item).map(([key]) => key)).toEqual(['a', 'b', 'a#1', 'a#2']);
    });

    it('splits an image reference into its repository and a readable digest', () => {
        const hex = '18b2ef37666b9eb65dc4d7e68fa923040584701801ce769eadd2ecfd8d658a61';
        expect(imageParts(`ghcr.io/sayandip-jana-1018/splitx@sha256:${hex}`)).toEqual({
            repository: 'ghcr.io/sayandip-jana-1018/splitx',
            digest: 'sha256:18b2ef37666b…d658a61',
        });
        expect(imageParts('ghcr.io/x/y:tag')).toEqual({ repository: 'ghcr.io/x/y:tag', digest: null });
        expect(imageParts('ghcr.io/x@sha256:short')).toEqual({ repository: 'ghcr.io/x', digest: 'sha256:short' });
    });
});
