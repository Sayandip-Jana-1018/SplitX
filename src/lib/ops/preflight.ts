import { NOT_CONNECTED, type ClusterReadings } from './cluster';
import type { AlertCounts, CodeScanning, Delivery, Pipeline, SiteChecks } from './github';
import { failedConditions, platformLabel, tally } from './present';
import type { QualityGate } from './quality';
import type { Reading } from './reading';

/**
 * The pre-flight list at the top of /ops (plan Phase 9, docs/DEMO_DAY.md):
 * before the demo, every tool green, or a red item that says what to fix. It
 * adds no source of its own: each item is a verdict on readings the page
 * already shows, so it can't disagree with them.
 *
 *   go         ready
 *   fix        not ready, and the detail says what to do
 *   wait       not decided yet: something is running, or hasn't reported
 *   elsewhere  doesn't apply where this page runs (the cluster, on Vercel)
 */
export type Readiness = 'go' | 'fix' | 'wait' | 'elsewhere';

export interface PreflightItem {
    key: string;
    title: string;
    readiness: Readiness;
    detail: string;
}

export interface PreflightInput {
    pipeline: Reading<Pipeline | null>;
    codeScanning: Reading<CodeScanning>;
    dependabot: Reading<AlertCounts & { capped: boolean }>;
    deliveries: Reading<Delivery[]>;
    qualityGate: Reading<QualityGate>;
    siteChecks: Reading<SiteChecks | null>;
    /** Undefined until ops-api's first answer. */
    cluster: Reading<ClusterReadings> | undefined;
}

const short = (sha: string) => sha.slice(0, 7);
const item = (key: string, title: string, readiness: Readiness, detail: string): PreflightItem => ({ key, title, readiness, detail });
/** A source that couldn't be read is something to fix, in its own words. */
const unread = (key: string, title: string, reading: { source: string; error: string }) =>
    item(key, title, 'fix', `${reading.source} can't be read: ${reading.error}`);

const SERIOUS = new Set(['critical', 'high', 'error']);
/** Open alerts at the levels that stop a release: critical and high (and CodeQL's "error"). */
function serious(counts: AlertCounts | undefined): number {
    return Object.entries(counts?.bySeverity ?? {}).reduce((sum, [level, count]) => sum + (SERIOUS.has(level) ? count : 0), 0);
}

function ci(pipeline: PreflightInput['pipeline']): PreflightItem {
    const title = 'CI on main';
    if (!pipeline.ok) return unread('ci', title, pipeline);
    const run = pipeline.data;
    if (!run) return item('ci', title, 'fix', 'No CI run on main yet: push to main.');
    if (!run.conclusion) return item('ci', title, 'wait', `${short(run.commit.sha)} is ${run.status.replaceAll('_', ' ')}: ${tally(run.jobs)}.`);
    if (run.conclusion === 'success') return item('ci', title, 'go', `${short(run.commit.sha)} passed: ${tally(run.jobs)}.`);
    const failed = run.jobs.filter((job) => job.conclusion && !['success', 'skipped'].includes(job.conclusion)).map((job) => job.name);
    return item('ci', title, 'fix', `${short(run.commit.sha)} ${run.conclusion.replaceAll('_', ' ')}${failed.length ? ` in ${failed.join(', ')}` : ''}: open the run, fix, and push.`);
}

function release(pipeline: PreflightInput['pipeline']): PreflightItem {
    const title = 'The release: scanned, signed, attested';
    const run = pipeline.ok ? pipeline.data : null;
    if (!run) return item('release', title, 'wait', 'Known once CI on main can be read.');
    if (!run.release) {
        return run.conclusion
            ? item('release', title, 'fix', `The release job didn't run for ${short(run.commit.sha)}: CI must pass first.`)
            : item('release', title, 'wait', `The release job hasn't run yet for ${short(run.commit.sha)}.`);
    }
    const missing = [
        run.release.scanned ? null : 'the scan gate failed',
        run.release.signed ? null : 'it is not signed',
        run.release.attested ? null : 'it is not attested',
    ].filter(Boolean);
    return missing.length
        ? item('release', title, 'fix', `${short(run.commit.sha)}: ${missing.join(', ')}. Open the release job.`)
        : item('release', title, 'go', `${short(run.commit.sha)}: no fixable critical or high vulnerability, signed with cosign, SBOM attested.`);
}

function codeScanning(reading: PreflightInput['codeScanning']): PreflightItem {
    const title = 'Code scanning: CodeQL and Trivy';
    if (!reading.ok) return unread('scanning', title, reading);
    const unscanned = ['CodeQL', 'Trivy'].filter((tool) => !reading.data.scans[tool]);
    if (unscanned.length) return item('scanning', title, 'wait', `No analysis of main yet by ${unscanned.join(' or ')}.`);
    const open = serious(reading.data.tools.CodeQL) + serious(reading.data.tools.Trivy);
    if (!open) return item('scanning', title, 'go', 'No critical or high alert open.');
    // One page of alerts is read; when it's full, the count is a floor.
    const floor = reading.data.capped ? '+' : '';
    return item('scanning', title, 'fix', `${open}${floor} critical or high alerts open: fix or dismiss them in the Security tab.`);
}

function dependabot(reading: PreflightInput['dependabot']): PreflightItem {
    const title = 'Dependabot';
    if (!reading.ok) return unread('dependabot', title, reading);
    const open = serious(reading.data);
    if (!open) return item('dependabot', title, 'go', 'No critical or high advisory open.');
    const floor = reading.data.capped ? '+' : '';
    return item('dependabot', title, 'fix', `${open}${floor} critical or high advisories open: update the dependencies it names.`);
}

function sonar(reading: PreflightInput['qualityGate']): PreflightItem {
    const title = 'SonarQube Cloud\'s gate';
    if (!reading.ok) return unread('sonar', title, reading);
    if (reading.data.status === 'OK') return item('sonar', title, 'go', 'Passed on new code.');
    if (reading.data.status === 'ERROR') return item('sonar', title, 'fix', `Failed: ${failedConditions(reading.data.conditions).join('; ') || 'see its conditions'}.`);
    return item('sonar', title, 'wait', 'No verdict yet: the next analysis gives one.');
}

/**
 * The checks run every 15 minutes (uptime.yml, D-106), so a newest run older
 * than this means the schedule stopped: GitHub pauses a public repository's
 * schedules after 60 days without activity.
 */
const SITE_CHECKS_STALE_MS = 45 * 60_000;

/** How the page words a production check that didn't pass. */
const SITE_CHECK_ENDINGS = new Map([
    ['failure', 'failed'],
    ['timed_out', 'timed out'],
]);

function site(reading: PreflightInput['siteChecks']): PreflightItem {
    const title = 'The live site';
    if (!reading.ok) return unread('site', title, reading);
    const run = reading.data;
    if (!run) return item('site', title, 'wait', 'The production checks haven\'t run yet.');
    // Judged against when GitHub was read, so the list says the same thing on every render.
    const minutes = Math.max(0, Math.round((Date.parse(reading.fetchedAt) - Date.parse(run.at)) / 60_000));
    if (minutes * 60_000 > SITE_CHECKS_STALE_MS) {
        return item('site', title, 'fix', `No production check for ${minutes} minutes: the schedule stopped. Run Actions → Production checks, and enable it if GitHub paused it.`);
    }
    if (run.conclusion === 'success') return item('site', title, 'go', `Passed every production check, ${minutes} min before this reading.`);
    if (run.conclusion === 'cancelled') return item('site', title, 'wait', 'The newest production check was cancelled; the next runs within 15 minutes.');
    const ended = SITE_CHECK_ENDINGS.get(run.conclusion ?? '') ?? `ended "${run.conclusion ?? 'without a verdict'}"`;
    return item('site', title, 'fix', `The newest production check ${ended}: open the run, and its incident issue.`);
}

/** The newest delivery Jenkins was asked for on this platform, if any. */
function newestFor(deliveries: PreflightInput['deliveries'], environment: string): Delivery | undefined {
    return deliveries.ok ? deliveries.data.find((delivery) => delivery.environment === environment) : undefined;
}

const digestOf = (image: string | null) => (image?.includes('@') ? image.slice(image.indexOf('@') + 1) : null);

function running(cluster: ClusterReadings, delivery: Delivery | undefined, environment: string): PreflightItem {
    const title = 'The newest release is what runs';
    if (!cluster.workloads.ok) return unread('running', title, cluster.workloads);
    if (!delivery) return item('running', title, 'wait', `No deployment for "${environment}" yet: the release job announces each release.`);
    if (delivery.state && ['in_progress', 'queued', 'pending'].includes(delivery.state)) {
        return item('running', title, 'wait', `Jenkins is deploying ${short(delivery.sha)}.`);
    }
    const wanted = digestOf(delivery.image);
    const digests = [...new Set(cluster.workloads.data.filter((pod) => pod.ready).map((pod) => pod.digest))];
    if (wanted && digests.length === 1 && digests[0] === wanted) {
        return item('running', title, 'go', `${short(delivery.sha)}, by digest, on every ready pod.`);
    }
    const said = delivery.description ? `: "${delivery.description}"` : '';
    return item('running', title, 'fix', `The pods don't run ${short(delivery.sha)}'s image; Jenkins reported ${delivery.state ?? 'nothing'}${said}. Read its build log.`);
}

function evidence(cluster: ClusterReadings, delivery: Delivery | undefined): PreflightItem {
    const title = 'Its evidence in Nexus';
    if (!cluster.evidence.ok) return unread('evidence', title, cluster.evidence);
    if (!delivery) return item('evidence', title, 'wait', 'Known once a release is deployed here.');
    const row = cluster.evidence.data.find((entry) => delivery.sha.startsWith(entry.commit));
    if (!row) return item('evidence', title, 'fix', `Nothing stored for ${short(delivery.sha)}: Jenkins' archive step says why.`);
    return row.complete
        ? item('evidence', title, 'go', `${short(delivery.sha)}: ${row.files.join(', ')}.`)
        : item('evidence', title, 'fix', `${short(delivery.sha)} is incomplete (${row.files.join(', ') || 'no files'}): Jenkins' archive step says why.`);
}

function nodes(cluster: ClusterReadings, onEks: boolean): PreflightItem {
    const title = 'Nodes';
    if (!cluster.nodes.ok) return unread('nodes', title, cluster.nodes);
    const list = cluster.nodes.data;
    const notReady = list.filter((node) => !node.ready).map((node) => node.name);
    if (!list.length || notReady.length) return item('nodes', title, 'fix', list.length ? `Not ready: ${notReady.join(', ')}.` : 'No nodes.');
    const zones = [...new Set(list.map((node) => node.zone).filter((zone): zone is string => Boolean(zone)))].sort((a, b) => a.localeCompare(b));
    if (onEks && zones.length < 2) return item('nodes', title, 'fix', `Every node is in ${zones[0] ?? 'one zone'}: the node group spans two.`);
    return item('nodes', title, 'go', `${list.length} ready${zones.length ? `, in ${zones.join(' and ')}` : ''}.`);
}

function pods(cluster: ClusterReadings): PreflightItem {
    const title = 'The app\'s pods';
    if (!cluster.workloads.ok) return unread('pods', title, cluster.workloads);
    const ready = cluster.workloads.data.filter((pod) => pod.ready).length;
    const minimum = cluster.autoscaler.ok ? cluster.autoscaler.data.min ?? 2 : 2;
    return ready >= minimum
        ? item('pods', title, 'go', `${ready} of ${cluster.workloads.data.length} ready.`)
        : item('pods', title, 'fix', `${ready} ready, below the autoscaler's minimum of ${minimum}: see the pods below.`);
}

function autoscaler(cluster: ClusterReadings): PreflightItem {
    const title = 'The autoscaler';
    if (!cluster.autoscaler.ok) return unread('autoscaler', title, cluster.autoscaler);
    const { current, cpuNowPercent, cpuTargetPercent } = cluster.autoscaler.data;
    if (cpuNowPercent === null) return item('autoscaler', title, 'wait', 'No CPU reading from metrics-server yet.');
    return item('autoscaler', title, 'go', `${current ?? '?'} pods at ${cpuNowPercent}% CPU, against a ${cpuTargetPercent ?? '?'}% target.`);
}

function alerts(cluster: ClusterReadings): PreflightItem {
    const title = 'Alerts';
    if (!cluster.alerts.ok) return unread('alerts', title, cluster.alerts);
    const firing = cluster.alerts.data.map((alert) => alert.name);
    return firing.length
        ? item('alerts', title, 'fix', `Firing: ${[...new Set(firing)].join(', ')}. Each says what is wrong below.`)
        : item('alerts', title, 'go', 'None firing.');
}

function logs(cluster: ClusterReadings): PreflightItem {
    const title = 'Logs in Loki';
    if (!cluster.logs.ok) return unread('logs', title, cluster.logs);
    return cluster.logs.data.length
        ? item('logs', title, 'go', `${cluster.logs.data.length} lines from the app in the last 15 minutes.`)
        : item('logs', title, 'fix', 'No lines from the app in 15 minutes: check that Alloy is running.');
}

function admissions(cluster: ClusterReadings): PreflightItem {
    const title = 'Admission control (Kyverno)';
    if (!cluster.admissions.ok) return unread('admissions', title, cluster.admissions);
    return item('admissions', title, 'go', `${cluster.admissions.data.allowed} allowed and ${cluster.admissions.data.refused} refused in 24 hours.`);
}

function lab(cluster: ClusterReadings): PreflightItem {
    const title = 'The traffic lab';
    if (!cluster.lab.ok) return unread('lab', title, cluster.lab);
    const { state, error } = cluster.lab.data;
    if (state === 'running' || state === 'stopping') return item('lab', title, 'wait', 'A run is going.');
    if (state === 'failed') return item('lab', title, 'fix', `The last run failed${error ? `: ${error}` : ''}. Start another to check.`);
    return item('lab', title, 'go', 'Ready to start.');
}

/* What only the EKS platform has: the edge, the account's stacks, the budget. */

function edge(cluster: ClusterReadings): PreflightItem {
    const title = 'CloudFront';
    if (!cluster.edge.ok) return unread('edge', title, cluster.edge);
    const { domain, status, enabled, online, origin } = cluster.edge.data;
    if (status !== 'Deployed') return item('edge', title, 'wait', `${domain} is still deploying a change.`);
    if (!enabled || !online) return item('edge', title, 'fix', `${domain} points at ${origin}: aws-up takes it online.`);
    return item('edge', title, 'go', `${domain}, in front of the load balancer.`);
}

const COMPLETE = /^(CREATE|UPDATE|IMPORT)_COMPLETE$/;

/** What is wrong with a stack, or null. */
function stackProblem(stack: { name: string; status: string; drift: string }): string | null {
    if (stack.drift === 'DRIFTED') return `${stack.name}: drifted`;
    return COMPLETE.test(stack.status) ? null : `${stack.name}: ${stack.status}`;
}

function stacks(cluster: ClusterReadings): PreflightItem {
    const title = 'CloudFormation';
    if (!cluster.stacks.ok) return unread('stacks', title, cluster.stacks);
    const problems = cluster.stacks.data.map(stackProblem).filter(Boolean);
    if (problems.length) return item('stacks', title, 'fix', `${problems.join('; ')}.`);
    // A stack CloudFormation never checked has no drift found only because
    // nobody looked, so the line says which, as the stacks panel does.
    const names = cluster.stacks.data.map((stack) => stack.name).join(' and ');
    const unchecked = cluster.stacks.data.filter((stack) => stack.drift !== 'IN_SYNC').map((stack) => stack.name);
    const drift = unchecked.length ? 'but ' + unchecked.join(' and ') + ' not yet checked for drift' : 'and in sync when drift was last checked';
    return item('stacks', title, 'go', `${names}: complete, ${drift}.`);
}

function budget(cluster: ClusterReadings): PreflightItem {
    const title = 'The budget';
    if (!cluster.budget.ok) return unread('budget', title, cluster.budget);
    const { limit, actual, forecast, unit } = cluster.budget.data;
    const money = (value: number | null) => (value === null ? '?' : `${value.toFixed(2)} ${unit}`);
    const over = limit !== null && ((actual ?? 0) > limit || (forecast ?? 0) > limit);
    if (over) return item('budget', title, 'fix', `${money(actual)} spent and ${money(forecast)} forecast, against ${money(limit)}: take the platform down after the demo.`);
    return item('budget', title, 'go', `${money(actual)} of ${money(limit)} this month.`);
}

/** Every pre-flight item, in the order the demo meets them. */
export function preflight(input: PreflightInput): PreflightItem[] {
    const items = [
        ci(input.pipeline), release(input.pipeline), codeScanning(input.codeScanning), dependabot(input.dependabot), sonar(input.qualityGate),
        site(input.siteChecks),
    ];
    const title = 'The platform';
    if (!input.cluster) return [...items, item('platform', title, 'wait', 'Asking ops-api.')];
    if (!input.cluster.ok) {
        return [...items, input.cluster.error === NOT_CONNECTED
            ? item('platform', title, 'elsewhere', NOT_CONNECTED)
            : unread('platform', title, input.cluster)];
    }
    const cluster = input.cluster.data;
    const target = cluster.platform.ok ? cluster.platform.data.target : 'kind';
    const onEks = target === 'eks';
    const delivery = newestFor(input.deliveries, target);
    return [
        ...items,
        item('platform', title, 'go', `Connected: Kubernetes on ${platformLabel(target)}.`),
        nodes(cluster, onEks),
        pods(cluster),
        running(cluster, delivery, target),
        evidence(cluster, delivery),
        autoscaler(cluster),
        admissions(cluster),
        alerts(cluster),
        logs(cluster),
        lab(cluster),
        ...(onEks ? [edge(cluster), stacks(cluster), budget(cluster)] : []),
    ];
}

/** The list in one line: "All 18 ready", or what stands in the way. */
export function preflightHeadline(items: readonly PreflightItem[]): string {
    const count = (readiness: Readiness) => items.filter((entry) => entry.readiness === readiness).length;
    const fix = count('fix');
    const wait = count('wait');
    if (!fix && !wait) return `All ${count('go')} ready.`;
    const parts = [fix ? `${fix} to fix` : null, wait ? `${wait} waiting` : null].filter(Boolean);
    return `${parts.join(', ')}; ${count('go')} ready.`;
}
