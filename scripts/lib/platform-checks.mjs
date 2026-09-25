/**
 * What k8s:verify and cd:verify conclude from what they read, kept pure so
 * the unit tests can hold each rule against the shapes Kubernetes and AWS
 * answer with (tests/unit/infra/eksVerify.test.ts). Most of it is for the EKS
 * platform (D-103), which only an AWS day runs.
 */

const ZONE = 'topology.kubernetes.io/zone';

/**
 * The nodes, and the zones of those nodes, that the given pods run on.
 * @param {object[]} pods
 * @param {object[]} nodes
 */
export function spreadOf(pods, nodes) {
    const zoneOf = new Map(nodes.map((node) => [node.metadata.name, node.metadata.labels?.[ZONE] ?? null]));
    const onNodes = [...new Set(pods.map((pod) => pod.spec?.nodeName).filter(Boolean))].sort();
    const zones = [...new Set(onNodes.map((node) => zoneOf.get(node)).filter(Boolean))].sort();
    return { nodes: onNodes, zones };
}

/**
 * Pods that are neither running with every container ready nor finished,
 * each with what holds it up (an image pull, a crash loop). A Job's pod that
 * ran and failed is its Job's to report (the release scan, Kyverno's report
 * clean-up), not a workload that isn't serving.
 * @param {object[]} pods
 * @returns {string[]}
 */
export function unhealthyPods(pods) {
    return pods.flatMap((pod) => {
        if (pod.metadata.deletionTimestamp || pod.status?.phase === 'Succeeded') return [];
        const ofJob = (pod.metadata.ownerReferences ?? []).some((owner) => owner.kind === 'Job');
        if (ofJob && pod.status?.phase === 'Failed') return [];
        const containers = pod.status?.containerStatuses ?? [];
        if (pod.status?.phase === 'Running' && containers.length > 0 && containers.every((c) => c.ready)) return [];
        const why = [...(pod.status?.initContainerStatuses ?? []), ...containers]
            .map((c) => c.state?.waiting?.reason ?? (c.state?.terminated?.exitCode ? c.state.terminated.reason : null))
            .find(Boolean);
        return [pod.metadata.namespace + '/' + pod.metadata.name + ': ' + (why ?? pod.status?.phase ?? 'no status')];
    });
}

// The AWS Load Balancer Controller's readiness gate (k8s/overlays/aws/patches/namespace.yaml).
const TARGET_HEALTH = /^target-health\.elbv2\.k8s\.aws\//;

/**
 * Pods the load balancer hasn't vouched for: without the controller's
 * readiness gate, or with the gate not yet true.
 * @param {object[]} pods
 * @returns {string[]}
 */
export function ungatedPods(pods) {
    return pods.filter((pod) => {
        const gated = (pod.spec?.readinessGates ?? []).some((gate) => TARGET_HEALTH.test(gate.conditionType));
        const healthy = (pod.status?.conditions ?? []).some((condition) => TARGET_HEALTH.test(condition.type) && condition.status === 'True');
        return !gated || !healthy;
    }).map((pod) => pod.metadata.name);
}

/**
 * The EKS cluster behind a kubeconfig context (aws eks update-kubeconfig names
 * its cluster by ARN), without the account: only its name and region.
 * @param {object} kubeconfig  kubectl config view -o json
 * @param {string} context
 */
export function eksClusterOf(kubeconfig, context) {
    const cluster = kubeconfig.contexts?.find((c) => c.name === context)?.context?.cluster ?? '';
    const match = cluster.match(/^arn:aws[a-z-]*:eks:([a-z0-9-]+):\d{12}:cluster\/(.+)$/);
    return match ? { region: match[1], name: match[2] } : null;
}

/**
 * The service accounts terraform/platform gives an AWS role (workloads.tf, and
 * the EBS CSI add-on in cluster.tf). Each must have its association.
 */
export const POD_IDENTITY_ACCOUNTS = [
    'kube-system/aws-load-balancer-controller',
    'kube-system/ebs-csi-controller-sa',
    'kube-system/cluster-autoscaler',
    'external-secrets/external-secrets',
    'ops/ops-api',
];

/**
 * Each Pod Identity association, judged twice: EKS gave its pods credentials
 * (the webhook adds AWS_CONTAINER_CREDENTIALS_FULL_URI at admission), and
 * those credentials did the account's job (`proofs`, read by the verifier).
 * An account in POD_IDENTITY_ACCOUNTS without an association is a finding too.
 * @param {{ namespace: string, serviceAccount: string, role: string }[]} associations
 * @param {object[]} pods  every pod in the cluster
 * @param {Record<string, { works: boolean, detail: string }>} proofs  by "namespace/serviceAccount"
 */
export function podIdentityFindings(associations, pods, proofs) {
    const associated = new Set(associations.map(({ namespace, serviceAccount }) => namespace + '/' + serviceAccount));
    const missing = POD_IDENTITY_ACCOUNTS.filter((account) => !associated.has(account)).map((account) => ({
        account, role: null, pods: 0, injected: false, works: null, detail: 'EKS has no Pod Identity association for it', ok: false,
    }));
    return [...associations.map(({ namespace, serviceAccount, role }) => {
        const account = namespace + '/' + serviceAccount;
        const running = pods.filter((pod) => pod.metadata.namespace === namespace
            && (pod.spec?.serviceAccountName ?? 'default') === serviceAccount
            && pod.status?.phase === 'Running' && !pod.metadata.deletionTimestamp);
        const injected = running.length > 0 && running.every((pod) => (pod.spec?.containers ?? []).some((container) =>
            (container.env ?? []).some((variable) => variable.name === 'AWS_CONTAINER_CREDENTIALS_FULL_URI')));
        const proof = proofs[account];
        return {
            account,
            role,
            pods: running.length,
            injected,
            works: proof ? proof.works : null,
            detail: proof ? proof.detail : 'nothing here shows what it does with AWS',
            ok: injected && proof?.works === true,
        };
    }), ...missing];
}

/** What stands between a Pod Identity finding and a pass, in words. */
export function identityProblem(finding) {
    if (finding.ok) return null;
    if (finding.role === null) return finding.detail;
    if (finding.pods === 0) return 'no pod running';
    if (!finding.injected) return 'its pods got no credentials';
    return finding.detail;
}

/**
 * What the Cluster Autoscaler's status ConfigMap says: the cluster's health,
 * and how many node groups it found. Finding them means asking AWS, which
 * only its Pod Identity role allows. Reads the YAML form (1.30 and later)
 * and the older text form.
 * @param {string | undefined} status
 */
export function autoscalerHealth(status) {
    const text = (status ?? '').replace(/\r\n/g, '\n');
    const healthy = /clusterWide:\s*\n\s+health:\s*\n\s+status:\s*Healthy\b/.test(text)
        || /Cluster-wide:\s*\n\s+Health:\s+Healthy\b/.test(text);
    const groups = text.split(/\n(?:nodeGroups|NodeGroups):[^\n]*\n/)[1] ?? '';
    const listed = (groups.match(/^\s*- name:\s*\S+/gm) ?? []).length;
    const nodeGroups = listed || (groups.match(/^\s*Name:\s*\S+/gm) ?? []).length;
    return { healthy, nodeGroups };
}

/** Why a claim's volume isn't what the platform promises, or null. */
function volumeProblem(claim, volume, described) {
    if (claim.status?.phase !== 'Bound') return 'not bound (' + (claim.status?.phase ?? 'no phase') + ')';
    if (volume?.spec?.csi?.driver !== 'ebs.csi.aws.com') return 'not an EBS volume';
    if (!described) return 'EC2 has no such volume';
    if (described.VolumeType !== 'gp3') return described.VolumeType + ', not gp3';
    if (described.Encrypted !== true) return 'not encrypted';
    if (described.State !== 'in-use') return described.State + ', not attached';
    return null;
}

/**
 * Every claim, and the EBS volume behind it as EC2 describes it: bound,
 * made by the EBS CSI driver, gp3, encrypted and attached (k8s/eks/storageclass.yaml).
 * @param {object[]} claims  kubectl get pvc --all-namespaces
 * @param {object[]} volumes  kubectl get pv
 * @param {{ VolumeId: string, VolumeType: string, Encrypted: boolean, State: string, AvailabilityZone: string }[]} described  aws ec2 describe-volumes
 */
export function ebsFindings(claims, volumes, described) {
    const byName = new Map(volumes.map((volume) => [volume.metadata.name, volume]));
    const byId = new Map(described.map((volume) => [volume.VolumeId, volume]));
    return claims.map((claim) => {
        const volume = byName.get(claim.spec?.volumeName);
        const id = volume?.spec?.csi?.volumeHandle ?? null;
        const found = id ? byId.get(id) : undefined;
        const problem = volumeProblem(claim, volume, found);
        return {
            claim: claim.metadata.namespace + '/' + claim.metadata.name,
            size: claim.status?.capacity?.storage ?? claim.spec?.resources?.requests?.storage ?? '?',
            volume: id,
            zone: found?.AvailabilityZone ?? null,
            problem,
            ok: problem === null,
        };
    });
}

/**
 * An ALB path pattern as a test: case-sensitive, `*` any run of characters,
 * `?` exactly one.
 * @param {string} pattern
 * @param {string} path
 */
export function matchesPathPattern(pattern, path) {
    const source = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*').replaceAll('?', '.');
    return new RegExp('^' + source + '$').test(path);
}

/**
 * What the load balancer does with a request for `path`: the first rule by
 * priority whose path patterns match it, else the listener's default. Target
 * groups are named without their ARN, which carries the account.
 * @param {object[]} rules  aws elbv2 describe-rules
 * @param {string} path
 * @returns {{ priority: string | null, action: 'respond' | 'forward' | 'none', status?: number, targetGroup?: string }}
 */
export function albDecision(rules, path) {
    const ordered = rules.filter((rule) => !rule.IsDefault).sort((a, b) => Number(a.Priority) - Number(b.Priority));
    const matches = (rule) => (rule.Conditions ?? []).every((condition) => condition.Field !== 'path-pattern'
        || (condition.PathPatternConfig?.Values ?? condition.Values ?? []).some((pattern) => matchesPathPattern(pattern, path)));
    const rule = ordered.find(matches) ?? rules.find((r) => r.IsDefault);
    const action = rule?.Actions?.find((a) => a.Type === 'fixed-response' || a.Type === 'forward');
    if (!action) return { priority: rule?.Priority ?? null, action: 'none' };
    if (action.Type === 'fixed-response') return { priority: rule.Priority, action: 'respond', status: Number(action.FixedResponseConfig?.StatusCode) };
    const arn = action.TargetGroupArn ?? action.ForwardConfig?.TargetGroups?.[0]?.TargetGroupArn ?? '';
    return { priority: rule.Priority, action: 'forward', targetGroup: arn.split(':targetgroup/')[1]?.split('/')[0] ?? '' };
}

/**
 * What each path must get from the load balancer. Its target groups are named
 * k8s-<namespace>-<service>-<hash> by the controller.
 */
export const ALB_EXPECTED = [
    { path: '/api/metrics', expect: { action: 'respond', status: 403 }, why: 'the second lock on Prometheus\' endpoint (the edge function is the first)' },
    { path: '/api/health/ready', expect: { action: 'respond', status: 403 }, why: 'the second lock on the probe that queries the database' },
    { path: '/generic-webhook-trigger/invoke', expect: { action: 'forward', group: 'k8s-jenkins-jenkins-' }, why: 'GitHub\'s deliveries, to Jenkins' },
    { path: '/api/health/live', expect: { action: 'forward', group: 'k8s-splitx-splitx-' }, why: 'liveness, for anyone' },
    { path: '/', expect: { action: 'forward', group: 'k8s-splitx-splitx-' }, why: 'the application' },
];

/** A load balancer's decision in words. */
function saidBy(decision) {
    if (decision.action === 'respond') return 'answers ' + decision.status + ' itself';
    if (decision.action === 'forward') return 'forwards to ' + decision.targetGroup;
    return 'has no rule for it';
}

/**
 * @param {object[]} rules  aws elbv2 describe-rules, for the listener on port 80
 */
export function albFindings(rules) {
    return ALB_EXPECTED.map(({ path, expect, why }) => {
        const got = albDecision(rules, path);
        const ok = expect.action === 'respond'
            ? got.action === 'respond' && got.status === expect.status
            : got.action === 'forward' && Boolean(got.targetGroup?.startsWith(expect.group));
        return { path, why, ok, detail: saidBy(got) + ' (rule ' + got.priority + ')' };
    });
}

/**
 * Spellings of the two internal paths. terraform/edge's function decodes,
 * lower-cases and collapses slashes before it compares, so each must be
 * refused at the edge, never passed on.
 */
export const INTERNAL_SPELLINGS = [
    '/api/metrics',
    '/api/health/ready',
    '/API/Metrics',
    '/api//metrics',
    '/api/metrics/',
    '/api/%6detrics',
    '//api/health/ready',
    '/api/health/ready/',
];

/** Whether CloudFront made a response itself, in a function: it says so in X-Cache. */
export function madeByEdgeFunction(xCache) {
    return /FunctionGeneratedResponse/i.test(xCache ?? '');
}

/**
 * Run inside an application pod on EKS (`kubectl exec -i <pod> -- node - <email>`),
 * with the Prisma client and the DATABASE_URL the app itself uses: the demo
 * database is Neon's, and nothing outside the cluster holds its address. It
 * counts the schema's tables, finds the account a check just registered, then
 * removes it and any confirmation link for that address, and prints only
 * numbers. A failure prints Prisma's error code, never its message, which can
 * name the database's host.
 */
export const DATABASE_PROBE = `
const { PrismaClient } = require('@prisma/client');
const email = process.argv[2];
const prisma = new PrismaClient();
(async () => {
    if (!/^k8s-verify\\+\\d+@example\\.invalid$/.test(email)) throw Object.assign(new Error(), { code: 'not a check address' });
    const [schema] = await prisma.$queryRawUnsafe("SELECT count(*)::int AS tables FROM information_schema.tables WHERE table_schema = 'public'");
    const stored = await prisma.user.count({ where: { email } });
    const links = await prisma.verificationToken.deleteMany({ where: { identifier: email } });
    const removed = await prisma.user.deleteMany({ where: { email } });
    const left = await prisma.user.count({ where: { email } });
    console.log(JSON.stringify({ tables: schema.tables, stored, removed: removed.count, links: links.count, left }));
})().catch((error) => {
    console.log(JSON.stringify({ error: error.code ?? error.errorCode ?? error.name }));
    process.exitCode = 1;
}).finally(() => prisma.$disconnect());
`;

/** The AWS readings ops-api makes with its Pod Identity role (ops/api/aws.mjs). */
const AWS_READINGS = ['stacks', 'eks', 'edge', 'budget'];

/**
 * @param {Record<string, { ok: boolean, error?: string }> | null} readings  ops-api's /v1/readings
 */
export function awsReadings(readings) {
    return AWS_READINGS.map((name) => ({ name, ok: readings?.[name]?.ok === true, error: readings?.[name]?.error ?? (readings ? null : 'ops-api did not answer') }));
}

/**
 * A Jenkins build GitHub's own webhook started: GWT names the deployment and
 * GitHub's delivery ID in the build's cause (helm/platform/jenkins.values.yaml,
 * causeString). A delivery ID is a UUID GitHub made; a hand-started or relayed
 * test would carry something else.
 * @param {{ number: number, result: string | null, actions?: { causes?: { shortDescription?: string }[] }[] }[]} builds
 * @param {number | string} deploymentId
 */
export function buildForDeployment(builds, deploymentId) {
    const pattern = new RegExp('^GitHub deployment ' + deploymentId + ', delivery [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
    return builds.find((build) => (build.actions ?? []).some((action) =>
        (action.causes ?? []).some((cause) => pattern.test(cause.shortDescription ?? '')))) ?? null;
}

const COSIGN_CHECKED = '; cosign checked:';

/**
 * What Jenkins' verify step wrote about the image's signature
 * (jenkins/deploy.mjs): the line naming the signer, and each check cosign
 * printed on the indented lines under it. Null when the log has no such line.
 * @param {string} buildLog a build's consoleText
 * @param {string} repository owner/name, as the signer's address names it
 */
export function cosignVerification(buildLog, repository) {
    const lines = buildLog.split('\n');
    const at = lines.findIndex((line) => line.includes('signed by https://github.com/' + repository));
    if (at === -1) return null;
    const first = lines[at].trim();
    const checks = [];
    for (const line of lines.slice(at + 1)) {
        const text = line.trim();
        if (!line.startsWith(' ') || !text.startsWith('- ')) break;
        checks.push(text.slice(2));
    }
    return { signed: first.endsWith(COSIGN_CHECKED) ? first.slice(0, -COSIGN_CHECKED.length) : first, checks };
}
