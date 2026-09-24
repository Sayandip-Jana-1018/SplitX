/**
 * The PromQL behind the traffic lab's charts on /ops: the Grafana dashboard's
 * own expressions (monitoring/dashboards/splitx-service.json), word for word,
 * so the page and Grafana always show the same numbers. A unit test
 * (tests/unit/infra/opsApi.test.ts) fails if either side changes alone.
 */

/** Requests from people: the probes and Prometheus' scrapes are left out. */
const PEOPLE = 'namespace="splitx", route!~"/api/health/.*|/api/metrics"';

export const CHARTS = {
    requests: {
        panel: 'Requests / s',
        title: 'Requests per second',
        unit: 'req/s',
        expr: `sum(rate(splitx_http_requests_total{${PEOPLE}}[1m])) or vector(0)`,
    },
    p95: {
        panel: 'Response time for people',
        title: 'p95 response time',
        unit: 's',
        expr: `histogram_quantile(0.95, sum by (le) (rate(splitx_http_request_duration_seconds_bucket{${PEOPLE}}[1m])))`,
    },
    errors: {
        panel: 'Unintended errors',
        title: 'Unintended errors',
        unit: 'ratio',
        // Server errors, less the previews the app refused on purpose (shed),
        // as a share of all requests from people.
        expr: `((sum(rate(splitx_http_requests_total{${PEOPLE}, status_code=~"5.."}[5m])) or vector(0)) - (sum(rate(splitx_settlement_previews_total{namespace="splitx", outcome="shed"}[5m])) or vector(0))) / (sum(rate(splitx_http_requests_total{${PEOPLE}}[5m])) > 0) or vector(0)`,
    },
    readyPods: {
        panel: 'Ready pods',
        title: 'Ready pods',
        unit: 'pods',
        expr: 'kube_deployment_status_replicas_available{namespace="splitx", deployment="splitx"}',
    },
    wantedPods: {
        panel: 'Autoscaler wants',
        title: 'Pods the autoscaler wants',
        unit: 'pods',
        expr: 'kube_horizontalpodautoscaler_status_desired_replicas{namespace="splitx", horizontalpodautoscaler="splitx"}',
    },
};

/**
 * Instant readings beside the charts, not on the service dashboard. The
 * delivery ones are the delivery dashboard's (monitoring/dashboards/splitx-delivery.json).
 */
export const GAUGES = {
    nodes: 'count(kube_node_info)',
    // Which pods are answering people right now: new ones join as the
    // autoscaler adds them (the service dashboard's filter, per pod).
    podsServing: `sum by (pod) (rate(splitx_http_requests_total{${PEOPLE}}[1m]))`,
    // Kyverno's own count of admission requests it answered, by whether it
    // allowed them, over the last day (its ServiceMonitor is on,
    // helm/platform/kyverno.values.yaml).
    admissions: 'sum by (request_allowed) (increase(kyverno_admission_requests_total[24h]))',
    lastDeploy: 'default_jenkins_builds_last_build_result_ordinal{jenkins_job="splitx-deploy"}',
    lastDeployMs: 'default_jenkins_builds_last_build_duration_milliseconds{jenkins_job="splitx-deploy"}',
};
