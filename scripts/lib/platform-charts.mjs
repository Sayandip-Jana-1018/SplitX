/**
 * The platform's pinned charts (helm/platform/charts.json) for one cluster, and
 * the exact `helm` command that installs each. Shared by both targets of
 * scripts/cluster-up.mjs: kind (the rehearsal cluster) and eks (D-093).
 */

const TARGETS = ['kind', 'eks'];

/**
 * The charts one target installs, in the order it installs them.
 * @param {{ charts: Array<Record<string, any>> }} file  helm/platform/charts.json, parsed
 * @param {'kind' | 'eks'} target
 */
export function chartsFor(file, target) {
    if (!TARGETS.includes(target)) throw new Error(`unknown target "${target}"; use ${TARGETS.join(' or ')}`);
    return file.charts.filter((chart) => chart.targets.includes(target));
}

/**
 * The helm repositories those charts come from, as `helm repo add` wants them.
 * @param {Array<Record<string, any>>} charts
 */
export function reposOf(charts) {
    return [...new Map(charts.map((chart) => [chart.chart.split('/')[0], chart.repo])).entries()];
}

/**
 * `helm upgrade --install` for one chart. Values that change with every AWS day
 * (the VPC, and on principle the cluster's name and region) are read from
 * terraform/platform's outputs, as the chart's `set` says.
 * @param {Record<string, any>} chart
 * @param {'kind' | 'eks'} target
 * @param {Record<string, string>} [outputs]  terraform output name -> value
 */
export function helmInstallArgs(chart, target, outputs = {}) {
    const argv = [
        'upgrade', '--install', chart.release, chart.chart,
        '--version', chart.version,
        '--namespace', chart.namespace, '--create-namespace',
        '--values', chart.values,
    ];
    if (target === 'eks' && chart.eksValues) argv.push('--values', chart.eksValues);
    for (const [path, output] of Object.entries(chart.set ?? {})) {
        const value = outputs[output];
        if (!value) throw new Error(`${chart.release} needs terraform/platform's output "${output}", which is empty`);
        argv.push('--set-string', `${path}=${value}`);
    }
    argv.push('--wait', '--timeout', chart.timeout ?? '6m');
    return argv;
}
