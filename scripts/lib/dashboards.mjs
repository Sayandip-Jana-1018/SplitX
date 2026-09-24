/**
 * What the committed Grafana dashboards ask Prometheus for.
 *
 * A panel that queries a metric nobody exports draws an empty graph forever,
 * and nothing else ever notices; a panel whose data source is an unfilled
 * export placeholder draws nothing at all. `npm run k8s:verify` uses these
 * helpers to run every query against the live Prometheus and to check that
 * every metric a query names is one Prometheus actually has.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every query in every dashboard under monitoring/dashboards, of one data
 * source type: 'prometheus' (PromQL) or 'loki' (LogQL).
 */
export function dashboardQueries(root, type = 'prometheus') {
    const dir = join(root, 'monitoring', 'dashboards');
    const queries = [];
    for (const file of readdirSync(dir).filter((name) => name.endsWith('.json')).sort()) {
        const dashboard = JSON.parse(readFileSync(join(dir, file), 'utf8'));
        const walk = (panels) => (panels || []).flatMap((panel) => [panel, ...walk(panel.panels)]);
        for (const panel of walk(dashboard.panels)) {
            for (const target of panel.targets || []) {
                const datasource = target.datasource || panel.datasource || {};
                if (!target.expr || datasource.type !== type) continue;
                queries.push({ file, uid: dashboard.uid, panel: panel.title, datasourceUid: datasource.uid, expr: target.expr });
            }
        }
    }
    return queries;
}

/** Every data source uid the dashboards refer to, of any type. */
export function dashboardDatasourceUids(root) {
    const dir = join(root, 'monitoring', 'dashboards');
    const uids = new Set();
    for (const file of readdirSync(dir).filter((name) => name.endsWith('.json'))) {
        JSON.stringify(JSON.parse(readFileSync(join(dir, file), 'utf8')), (key, value) => {
            if (key === 'datasource' && value && typeof value === 'object' && value.uid && !String(value.uid).startsWith('-- ')) uids.add(value.uid);
            return value;
        });
    }
    return [...uids].sort();
}

/**
 * Series a source publishes only once the event they count has happened, so a
 * fresh cluster can't have them yet, each with the source's reason. k8s:verify
 * reports them as not published yet, and cd:verify proves the Jenkins one
 * appears with the first failed deploy (D-102).
 */
export const FIRST_EVENT_SERIES = new Map([
    [
        'default_jenkins_builds_failed_build_count_total',
        'Jenkins publishes it with its first failed build (its Prometheus plugin makes the series in BuildFailedCounter only for a failure, and leaves out empty families)',
    ],
]);

// PromQL words that are not metric names.
const NOT_METRICS = new Set([
    'sum', 'min', 'max', 'avg', 'count', 'stddev', 'stdvar', 'topk', 'bottomk', 'quantile', 'count_values', 'group',
    'rate', 'irate', 'increase', 'delta', 'idelta', 'deriv', 'predict_linear', 'resets', 'changes',
    'histogram_quantile', 'histogram_count', 'histogram_sum', 'histogram_fraction',
    'avg_over_time', 'min_over_time', 'max_over_time', 'sum_over_time', 'count_over_time', 'last_over_time', 'quantile_over_time',
    'abs', 'ceil', 'floor', 'round', 'clamp', 'clamp_min', 'clamp_max', 'exp', 'ln', 'log2', 'log10', 'sqrt', 'sgn',
    'absent', 'absent_over_time', 'scalar', 'vector', 'time', 'timestamp', 'sort', 'sort_desc', 'label_replace', 'label_join',
    'by', 'without', 'on', 'ignoring', 'group_left', 'group_right', 'and', 'or', 'unless', 'bool', 'offset',
]);

/** The metric names a PromQL expression reads. */
export function metricNamesIn(expr) {
    const names = new Set();
    const stripped = expr
        .replace(/"(?:[^"\\]|\\.)*"/g, '""') // label values and regexes
        .replace(/\{[^}]*\}/g, ' ') // label matchers
        .replace(/\[[^\]]*\]/g, ' ') // ranges, including Grafana's $__range
        .replace(/\b(by|without|on|ignoring|group_left|group_right)\s*\([^)]*\)/g, ' '); // grouping labels
    for (const [word] of stripped.matchAll(/[a-zA-Z_:][a-zA-Z0-9_:]*/g)) {
        if (!NOT_METRICS.has(word)) names.add(word);
    }
    return [...names];
}

/** Grafana's range variables, replaced by something Prometheus accepts on its own. */
export const withoutGrafanaVariables = (expr) => expr.replace(/\$__range|\$__rate_interval|\$__interval/g, '1h');
