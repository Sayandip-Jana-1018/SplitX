/**
 * `node scripts/cluster-up.mjs --target eks` (D-093): SplitX's platform on the
 * EKS cluster aws-up has just built. aws-up runs it on GitHub's runner with
 * kubectl's context "splitx" (aws eks update-kubeconfig --alias splitx), and
 * with helm, terraform (both roots initialised) and the AWS CLI on PATH.
 *
 *   1. what the platform is: terraform/platform's outputs, and three committed
 *      facts checked against AWS: the edge's address (k8s/overlays/aws), the
 *      secrets' region (k8s/eks/secrets) and CloudFront's prefix list
 *   2. the namespaces, with their Pod Security levels
 *   3. the External Secrets Operator, then the Secrets it makes from
 *      splitx/demo/* (k8s/eks/secrets): the names and keys k8s:up builds from
 *      .env on Kind, so everything after reads them unchanged. Nothing here
 *      generates a secret: a missing one stops the run.
 *   4. the other charts for eks, in helm/platform/charts.json's order
 *   5. the admission policy first, then the app (k8s/overlays/aws, with the
 *      release to run), the dashboards, and Jenkins' EKS additions
 *   6. waits for Redis, the app, and the load balancer's address
 *
 * Idempotent, like the Kind path: every step applies or upgrades.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { admittedPrefixList, committedEdge, releaseImage, storeRegion } from './eks-facts.mjs';
import { chartsFor, helmInstallArgs, reposOf } from './platform-charts.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param {{ root: string, context?: string, image?: string }} options
 *   image: ghcr.io/sayandip-jana-1018/splitx@sha256:<digest>, the release to run;
 *   without it, the tag k8s/overlays/aws pins.
 */
export async function upEks({ root, context = 'splitx', image = '' }) {
    let step = 0;
    const heading = (text) => console.log('\n[' + ++step + '] ' + text);
    const fail = (message) => {
        console.error('\nx ' + message);
        process.exit(1);
    };
    function run(file, argv, options = {}) {
        const { input, capture = false, allowFailure = false } = options;
        const result = spawnSync(file, argv, {
            cwd: root,
            input,
            encoding: 'utf8',
            stdio: capture || input !== undefined ? ['pipe', 'pipe', 'pipe'] : 'inherit',
            shell: false,
        });
        if (result.error) fail('could not run ' + file + ': ' + result.error.message);
        if (result.status !== 0 && !allowFailure) {
            if (result.stderr) console.error(result.stderr.trim());
            fail(file + ' ' + argv.slice(0, 3).join(' ') + ' exited ' + result.status);
        }
        return { code: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
    }
    const kubectl = (argv, options) => run('kubectl', ['--context', context, ...argv], options);
    const read = (path) => readFileSync(join(root, path), 'utf8');
    const release = image ? releaseImage(image) : null;

    // ── 1. what the platform is ───────────────────────────────────────────────
    heading('Checking tools');
    for (const [tool, argv] of [['kubectl', ['version', '--client']], ['helm', ['version', '--short']], ['terraform', ['version']], ['aws', ['--version']]]) {
        const probe = spawnSync(tool, argv, { encoding: 'utf8', shell: false });
        if (probe.error || probe.status !== 0) fail(tool + ' is not on PATH');
        console.log('    ' + tool + ' ok');
    }

    heading('What the platform is');
    const raw = JSON.parse(run('terraform', ['-chdir=terraform/platform', 'output', '-json'], { capture: true }).stdout || '{}');
    /** @type {Record<string, string>} */
    const outputs = Object.fromEntries(Object.entries(raw).map(([name, output]) => [name, Array.isArray(output.value) ? output.value.join(',') : String(output.value)]));
    if (!outputs.cluster_name) fail('terraform/platform has no outputs: the platform is not built (aws-up builds it first)');
    console.log('    cluster ' + outputs.cluster_name + ', Kubernetes ' + outputs.kubernetes_version + ', ' + outputs.region + ', ' + outputs.vpc_id);

    // The edge's address is committed once (NEXTAUTH_URL) and must be the
    // distribution terraform/edge manages: the app builds its links from it,
    // and Jenkins checks each release through it.
    const edge = committedEdge(read('k8s/overlays/aws/kustomization.yaml'));
    if (!edge) fail('k8s/overlays/aws has no address yet: run the AWS edge workflow, then commit its domain as NEXTAUTH_URL there');
    const distribution = run('terraform', ['-chdir=terraform/edge', 'output', '-raw', 'domain_name'], { capture: true, allowFailure: true }).stdout.trim();
    if (distribution !== edge.host) fail('k8s/overlays/aws says ' + edge.host + ', but terraform/edge\'s distribution is ' + (distribution || 'not there'));
    console.log('    the edge: ' + edge.url);

    const secretsRegion = storeRegion(read('k8s/eks/secrets/clustersecretstore.yaml'));
    if (secretsRegion !== outputs.region) fail('k8s/eks/secrets reads Secrets Manager in ' + secretsRegion + ', but the platform is in ' + outputs.region);

    // Prefix list IDs differ by region. The committed one must be CloudFront's
    // here, or the load balancer would admit nobody (or somebody else).
    const admitted = admittedPrefixList(read('k8s/overlays/aws/patches/ingress.yaml'));
    const cloudfront = run('aws', ['ec2', 'describe-managed-prefix-lists', '--region', outputs.region,
        '--filters', 'Name=prefix-list-name,Values=com.amazonaws.global.cloudfront.origin-facing',
        '--query', 'PrefixLists[0].PrefixListId', '--output', 'text'], { capture: true }).stdout.trim();
    if (cloudfront !== admitted) fail('k8s/overlays/aws admits ' + admitted + ', but CloudFront\'s origin-facing prefix list in ' + outputs.region + ' is ' + cloudfront);
    console.log('    the load balancer will admit ' + admitted + ' (CloudFront, origin-facing) and nothing else');

    // ── 2. namespaces ─────────────────────────────────────────────────────────
    heading('Namespaces, with their Pod Security levels');
    kubectl(['apply', '-f', 'helm/platform/namespaces.yaml', '-f', 'helm/platform/eks/namespaces.yaml', '-f', 'k8s/base/namespace.yaml'], { capture: true });
    console.log('    monitoring, node-exporter, jenkins, kyverno, external-secrets, splitx');

    const charts = chartsFor(JSON.parse(read('helm/platform/charts.json')), 'eks');
    const repos = reposOf(charts);
    for (const [name, url] of repos) run('helm', ['repo', 'add', name, url], { capture: true, allowFailure: true });
    run('helm', ['repo', 'update', ...repos.map(([name]) => name)], { capture: true });
    const install = (chart) => {
        console.log('    ' + chart.release + ' ' + chart.version + ' -> ' + chart.namespace);
        run('helm', ['--kube-context', context, ...helmInstallArgs(chart, 'eks', outputs)], { capture: true });
    };

    // ── 3. secrets ────────────────────────────────────────────────────────────
    heading('The External Secrets Operator, and the Secrets it makes from Secrets Manager');
    for (const chart of charts.filter((c) => c.stage === 'secrets')) install(chart);
    // The operator's webhook validates the store; it answers a few seconds
    // after its pods are ready, once its certificate is in place.
    let applied = { code: 1, stderr: '' };
    for (let attempt = 1; attempt <= 12 && applied.code !== 0; attempt++) {
        if (attempt > 1) await sleep(10_000);
        applied = kubectl(['apply', '-k', 'k8s/eks/secrets'], { capture: true, allowFailure: true });
    }
    if (applied.code !== 0) fail('could not apply k8s/eks/secrets:\n' + applied.stderr.trim());
    const synced = kubectl(['wait', 'externalsecrets.external-secrets.io', '--all', '--all-namespaces', '--for=condition=Ready', '--timeout=180s'], { capture: true, allowFailure: true });
    const secrets = JSON.parse(kubectl(['get', 'externalsecrets.external-secrets.io', '--all-namespaces', '-o', 'json'], { capture: true }).stdout).items;
    for (const secret of secrets) {
        const ready = secret.status?.conditions?.find((condition) => condition.type === 'Ready');
        // The operator's own words name the key or the permission, never a value.
        console.log('    ' + secret.metadata.namespace + '/' + secret.metadata.name + ': ' + (ready?.status === 'True' ? 'synced' : 'NOT synced, ' + (ready?.message ?? 'no status yet')));
    }
    if (synced.code !== 0) fail('the platform\'s Secrets did not sync from Secrets Manager. Run `npm run aws:secrets` on the laptop before an AWS day.');

    // ── 4. the other charts ───────────────────────────────────────────────────
    heading('The other charts (pinned in helm/platform/charts.json)');
    // Jenkins reads the edge's address from here (helm/platform/eks/jenkins.values.yaml).
    kubectl(['apply', '-f', '-'], {
        input: JSON.stringify({
            apiVersion: 'v1',
            kind: 'ConfigMap',
            metadata: { name: 'splitx-edge', namespace: 'jenkins', labels: { 'app.kubernetes.io/part-of': 'splitx' } },
            data: { url: edge.url, host: edge.host },
        }),
    });
    for (const chart of charts.filter((c) => c.stage !== 'secrets')) install(chart);

    // ── 5. manifests ──────────────────────────────────────────────────────────
    heading('Manifests: the admission policy, the app, the dashboards and Jenkins\' additions');
    // The policy first, so the app's very first pods are admitted only if the
    // release workflow signed their image (policy/verify-release.yaml, D-060).
    kubectl(['apply', '-k', 'policy']);
    // The overlay as committed, with the release to run pinned by digest, the
    // way Jenkins deploys it (jenkins/deploy.mjs).
    const work = mkdtempSync(join(root, '.cluster-up-eks-'));
    try {
        const kustomization = { apiVersion: 'kustomize.config.k8s.io/v1beta1', kind: 'Kustomization', resources: ['../k8s/overlays/aws'] };
        if (release) kustomization.images = [{ name: 'splitx', newName: release.name, digest: release.digest }];
        writeFileSync(join(work, 'kustomization.yaml'), JSON.stringify(kustomization, null, 2));
        kubectl(['apply', '-k', work]);
    } finally {
        rmSync(work, { recursive: true, force: true });
    }
    kubectl(['apply', '-k', 'monitoring']);
    kubectl(['apply', '-k', 'jenkins/eks']);

    // ── 6. waits ──────────────────────────────────────────────────────────────
    heading('Waiting for Redis, the app and the load balancer');
    kubectl(['-n', 'splitx', 'rollout', 'status', 'deployment/splitx-redis', '--timeout=180s']);
    kubectl(['-n', 'splitx', 'rollout', 'status', 'deployment/splitx', '--timeout=600s']);
    let alb = '';
    for (let attempt = 0; attempt < 40 && !alb; attempt++) {
        if (attempt > 0) await sleep(15_000);
        alb = kubectl(['-n', 'splitx', 'get', 'ingress', 'splitx', '-o', 'jsonpath={.status.loadBalancer.ingress[0].hostname}'], { capture: true, allowFailure: true }).stdout.trim();
    }
    if (!alb) fail('no load balancer after 10 minutes; its controller says why: kubectl -n kube-system logs deployment/aws-load-balancer-controller');
    console.log('    the load balancer: ' + alb);

    heading('Cluster state');
    console.log(kubectl(['-n', 'splitx', 'get', 'pods', '-o', 'wide'], { capture: true }).stdout.trim());
    console.log('');
    console.log(kubectl(['get', 'ingress', '--all-namespaces'], { capture: true }).stdout.trim());
    console.log('\nThe platform is up. aws-up points the edge at the load balancer next.');
    return { alb };
}
