import { describe, expect, it } from 'vitest';
import { dashboardQueries, FIRST_EVENT_SERIES, metricNamesIn } from '../../../scripts/lib/dashboards.mjs';

/*
 * What k8s:verify asks of the committed Grafana dashboards: every metric a
 * query names must exist in Prometheus, except the few a source publishes only
 * after the event they count (D-102).
 */

describe('the metrics a dashboard query names', () => {
    it('are the metric names only, not functions, labels or ranges', () => {
        expect(metricNamesIn('sum(increase(default_jenkins_builds_failed_build_count_total{jenkins_job="splitx-deploy"}[$__rate_interval]))'))
            .toEqual(['default_jenkins_builds_failed_build_count_total']);
        expect(metricNamesIn('histogram_quantile(0.95, sum by (le) (rate(splitx_http_request_duration_seconds_bucket{route!~"/api/health/.*"}[5m])))'))
            .toEqual(['splitx_http_request_duration_seconds_bucket']);
    });
});

describe('series that exist only after their first event (D-102)', () => {
    const named = new Set(dashboardQueries('.').flatMap((query) => metricNamesIn(query.expr)));

    it('are each read by a committed dashboard, so the list names nothing stale', () => {
        expect(FIRST_EVENT_SERIES.size).toBeGreaterThan(0);
        for (const name of FIRST_EVENT_SERIES.keys()) expect(named.has(name), name).toBe(true);
    });

    it('each say why they are missing on a fresh cluster', () => {
        for (const reason of FIRST_EVENT_SERIES.values()) expect(reason).toMatch(/first/);
    });
});
