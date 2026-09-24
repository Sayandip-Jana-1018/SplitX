/**
 * What each source answers, turned into what /ops shows (D-097). Pure: no
 * network here, so the unit tests feed these recorded answers.
 *
 * Nothing that identifies the AWS account leaves ops-api: no ARN, no account
 * ID, and never an origin's custom headers (the edge's secret, D-092).
 */

const ZONE = 'topology.kubernetes.io/zone';
const INSTANCE_TYPE = 'node.kubernetes.io/instance-type';

/** A Kubernetes CPU quantity ("250m", "2", "1234567n") in cores. */
export function cpuCores(quantity) {
    const text = String(quantity);
    const scale = { n: 1e-9, u: 1e-6, m: 1e-3 }[text.slice(-1)];
    return scale ? Number(text.slice(0, -1)) * scale : Number(text);
}

/** A Kubernetes memory quantity ("8127276Ki", "512Mi", "1G") in bytes. */
export function bytes(quantity) {
    const match = String(quantity).match(/^([0-9.]+)([A-Za-z]*)$/);
    if (!match) return NaN;
    const units = { '': 1, k: 1e3, M: 1e6, G: 1e9, T: 1e12, Ki: 2 ** 10, Mi: 2 ** 20, Gi: 2 ** 30, Ti: 2 ** 40 };
    return Number(match[1]) * (units[match[2]] ?? NaN);
}

const percent = (part, whole) => (Number.isFinite(part) && Number.isFinite(whole) && whole > 0 ? Math.round((100 * part) / whole) : null);
const isReady = (conditions) => conditions?.some((condition) => condition.type === 'Ready' && condition.status === 'True') ?? false;

/** The nodes, with their zone, type, readiness and how busy they are (metrics-server). */
export function summariseNodes(nodeList, metricsList) {
    const usage = new Map((metricsList?.items ?? []).map((metric) => [metric.metadata.name, metric.usage]));
    return nodeList.items
        .map((node) => {
            const used = usage.get(node.metadata.name);
            const allocatable = node.status?.allocatable ?? {};
            return {
                name: node.metadata.name,
                zone: node.metadata.labels?.[ZONE] ?? null,
                instanceType: node.metadata.labels?.[INSTANCE_TYPE] ?? null,
                ready: isReady(node.status?.conditions),
                cpuPercent: used ? percent(cpuCores(used.cpu), cpuCores(allocatable.cpu)) : null,
                memoryPercent: used ? percent(bytes(used.memory), bytes(allocatable.memory)) : null,
                since: node.metadata.creationTimestamp ?? null,
            };
        })
        .sort((a, b) => String(a.zone).localeCompare(String(b.zone)) || a.name.localeCompare(b.name));
}

/** The application's pods: where each runs, whether it serves, and which build. */
export function summarisePods(podList, nodes = []) {
    const zones = new Map(nodes.map((node) => [node.name, node.zone]));
    return podList.items
        .filter((pod) => !pod.metadata.deletionTimestamp)
        .map((pod) => {
            const app = pod.status?.containerStatuses?.find((container) => container.name === 'splitx');
            return {
                name: pod.metadata.name,
                node: pod.spec?.nodeName ?? null,
                zone: zones.get(pod.spec?.nodeName) ?? null,
                phase: pod.status?.phase ?? 'Unknown',
                ready: isReady(pod.status?.conditions),
                restarts: (pod.status?.containerStatuses ?? []).reduce((sum, container) => sum + (container.restartCount ?? 0), 0),
                // The digest the kubelet pulled, not the tag asked for.
                digest: app?.imageID?.split('@')[1]?.slice(0, 19) ?? null,
                since: pod.status?.startTime ?? null,
            };
        })
        .sort((a, b) => String(a.since).localeCompare(String(b.since)));
}

/** The HorizontalPodAutoscaler (autoscaling/v2): bounds, where it is, where it wants to be. */
export function summariseAutoscaler(hpa) {
    const cpu = (list) => list?.find((metric) => metric.type === 'Resource' && metric.resource?.name === 'cpu');
    return {
        min: hpa.spec?.minReplicas ?? null,
        max: hpa.spec?.maxReplicas ?? null,
        current: hpa.status?.currentReplicas ?? null,
        desired: hpa.status?.desiredReplicas ?? null,
        cpuTargetPercent: cpu(hpa.spec?.metrics)?.resource?.target?.averageUtilization ?? null,
        cpuNowPercent: cpu(hpa.status?.currentMetrics)?.resource?.current?.averageUtilization ?? null,
        lastScaled: hpa.status?.lastScaleTime ?? null,
    };
}

/** A Prometheus instant vector's first value, or null when there is none (or NaN). */
export function scalar(result) {
    const value = Number(result?.[0]?.value?.[1]);
    return Number.isFinite(value) ? value : null;
}

/** A Prometheus range query's first series as [unix seconds, value] pairs; gaps stay null. */
export function series(result) {
    return (result?.[0]?.values ?? []).map(([time, value]) => {
        const number = Number(value);
        return [Number(time), Number.isFinite(number) ? number : null];
    });
}

/** A Prometheus instant vector as { labelValue: value }. */
export function byLabel(result, label) {
    return Object.fromEntries((result ?? []).map((sample) => [sample.metric?.[label] ?? 'none', Number(sample.value?.[1])]));
}

/** Jenkins' result ordinals (hudson.model.Result). */
export const JENKINS_RESULTS = ['success', 'unstable', 'failure', 'not built', 'aborted'];

const SEVERITY_ORDER = ['critical', 'warning', 'info', 'none'];

/** Alerts that are firing, most severe first; the always-on Watchdog and its helper left out. */
export function summariseAlerts(alerts) {
    return alerts
        .filter((alert) => alert.status?.state === 'active' && !['Watchdog', 'InfoInhibitor'].includes(alert.labels?.alertname))
        .map((alert) => ({
            name: alert.labels.alertname,
            severity: alert.labels.severity ?? 'none',
            namespace: alert.labels.namespace ?? null,
            since: alert.startsAt ?? null,
            summary: alert.annotations?.summary ?? alert.annotations?.description ?? '',
        }))
        .sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) || String(a.since).localeCompare(String(b.since)));
}

/** Loki's streams as log lines, newest first: the app writes one JSON object per line. */
export function summariseLogs(result, limit = 40) {
    const lines = [];
    for (const stream of result ?? []) {
        for (const [nanoseconds, line] of stream.values ?? []) {
            let entry = null;
            try {
                entry = JSON.parse(line);
            } catch {
                entry = null;
            }
            lines.push({
                // Loki counts nanoseconds; the first 13 digits are milliseconds.
                time: new Date(Number(String(nanoseconds).slice(0, -6))).toISOString(),
                level: entry?.level ?? stream.stream?.level ?? null,
                message: String(entry?.msg ?? entry?.message ?? line).slice(0, 300),
                requestId: entry?.requestId ?? null,
                pod: stream.stream?.pod ?? entry?.pod ?? null,
            });
        }
    }
    return lines.sort((a, b) => b.time.localeCompare(a.time)).slice(0, limit);
}

const EVIDENCE_FILES = ['deployment.json', 'sbom.cdx.json', 'vuln.json'];

/**
 * The evidence Jenkins stored in Nexus (jenkins/deploy.mjs, archive), one
 * entry per deployment at <commit>/<deployment>/, newest first.
 */
export function summariseEvidence(assets, limit = 5) {
    const deployments = new Map();
    for (const asset of assets) {
        const [commit, deployment, file] = String(asset.path ?? '').replace(/^\//, '').split('/');
        if (!commit || !deployment || !file) continue;
        const key = commit + '/' + deployment;
        const entry = deployments.get(key) ?? { commit: commit.slice(0, 12), deployment, files: [], storedAt: null };
        entry.files.push(file);
        const at = asset.lastModified ?? asset.blobCreated ?? null;
        if (at && (!entry.storedAt || at > entry.storedAt)) entry.storedAt = at;
        deployments.set(key, entry);
    }
    return [...deployments.values()]
        .sort((a, b) => String(b.storedAt).localeCompare(String(a.storedAt)))
        .slice(0, limit)
        .map((entry) => ({ ...entry, files: entry.files.sort(), complete: EVIDENCE_FILES.every((file) => entry.files.includes(file)) }));
}

const iso = (value) => (value instanceof Date ? value.toISOString() : value ?? null);

/** The CloudFormation stacks: status and drift, as CloudFormation last found it. */
export function summariseStacks(stacks) {
    return stacks.map((stack) => ({
        name: stack.StackName,
        status: stack.StackStatus,
        updatedAt: iso(stack.LastUpdatedTime ?? stack.CreationTime),
        drift: stack.DriftInformation?.StackDriftStatus ?? 'NOT_CHECKED',
        driftCheckedAt: iso(stack.DriftInformation?.LastCheckTimestamp),
    }));
}

/** The EKS cluster, its node groups and add-ons. No ARN: it names the account. */
export function summariseEks(cluster, nodegroups, addons) {
    return {
        name: cluster.name,
        version: cluster.version,
        platformVersion: cluster.platformVersion ?? null,
        status: cluster.status,
        authenticationMode: cluster.accessConfig?.authenticationMode ?? null,
        nodegroups: nodegroups.map((group) => ({
            name: group.nodegroupName,
            status: group.status,
            instanceTypes: group.instanceTypes ?? [],
            min: group.scalingConfig?.minSize ?? null,
            max: group.scalingConfig?.maxSize ?? null,
            desired: group.scalingConfig?.desiredSize ?? null,
        })),
        addons: addons.map((addon) => ({ name: addon.addonName, version: addon.addonVersion, status: addon.status })).sort((a, b) => a.name.localeCompare(b.name)),
    };
}

/**
 * The CloudFront distribution, from ListDistributions' summary. Fields are
 * copied one by one: the origins carry the edge's secret header (D-092),
 * which must never reach a page.
 */
export function summariseDistribution(distribution) {
    const origin = distribution.Origins?.Items?.[0]?.DomainName ?? null;
    return {
        id: distribution.Id,
        domain: distribution.DomainName,
        status: distribution.Status,
        enabled: distribution.Enabled,
        online: typeof origin === 'string' && origin.endsWith('.elb.amazonaws.com'),
        origin: typeof origin === 'string' && origin.endsWith('.elb.amazonaws.com') ? 'the load balancer' : 'the offline page',
        httpVersion: distribution.HttpVersion ?? null,
        priceClass: distribution.PriceClass ?? null,
        lastModified: iso(distribution.LastModifiedTime),
    };
}

/** The monthly budget: its limit, what has been spent, and AWS' forecast. */
export function summariseBudget(budget) {
    const amount = (value) => (value?.Amount === undefined ? null : Number(value.Amount));
    return {
        name: budget.BudgetName,
        unit: budget.BudgetLimit?.Unit ?? 'USD',
        limit: amount(budget.BudgetLimit),
        actual: amount(budget.CalculatedSpend?.ActualSpend),
        forecast: amount(budget.CalculatedSpend?.ForecastedSpend),
    };
}
