/**
 * The cluster k8s:verify and cd:verify check (D-103): the Kind cluster, on a
 * laptop or a kind-e2e runner, or the EKS platform aws-up builds on an AWS day.
 *
 *   node scripts/cluster-verify.mjs [--target kind|eks] [--context <name>]
 *   node scripts/delivery-verify.mjs [--target kind|eks] [--context <name>] [--rollback]
 *
 * What differs is kept here: where visitors arrive, which GitHub environment
 * this cluster's Jenkins deploys, how the verifiers reach what isn't
 * published, and where the platform's secrets come from. The checks
 * themselves stay in the two scripts, shared wherever the clusters agree.
 */
import { spawn, spawnSync } from 'node:child_process';
import { committedEdge } from './eks-facts.mjs';

/**
 * Why a Kind check has nothing to check on EKS. Each is reported as skipped,
 * with its reason, never as passed.
 */
export const KIND_ONLY = {
    controlPlane: 'EKS runs the control plane outside the cluster: there is no control-plane node for a pod to land on',
    kindnet: 'kindnet is Kind\'s network-policy engine; EKS judges connections with the VPC CNI\'s policy agent, which the network-policy check tests',
    databaseOutage: 'the database is Neon\'s demo branch, outside the cluster, and stopping it would stop the demo; kind-e2e takes its own Postgres down instead (D-037)',
    ingressTrace: 'the load balancer keeps no log Loki can read; the request is followed from the pod that served it instead',
};

/**
 * @param {string[]} argv  the script's arguments
 * @param {(path: string) => string} read  reads a committed file
 */
export function verifyTarget(argv, read) {
    const option = (name) => {
        const index = argv.indexOf(name);
        return index >= 0 && argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[index + 1] : undefined;
    };
    const name = option('--target') ?? 'kind';
    if (name === 'kind') {
        return {
            name,
            context: option('--context') ?? 'kind-splitx',
            // ingress-nginx on port 80, and Jenkins and Grafana on its host names.
            base: 'http://localhost',
            environment: 'kind',
            // A deployment for the other cluster: this Jenkins must start nothing.
            otherEnvironment: 'eks',
            probeImage: 'busybox:1.37.0',
            reports: { cluster: 'docs/evidence/kubernetes.md', delivery: 'docs/evidence/delivery.md' },
        };
    }
    if (name !== 'eks') throw new Error('--target is kind (the default) or eks, not ' + name);
    const edge = committedEdge(read('k8s/overlays/aws/kustomization.yaml'));
    if (!edge) throw new Error('k8s/overlays/aws has no edge address yet: run the AWS edge workflow, then commit its domain as NEXTAUTH_URL there');
    return {
        name,
        // aws-up names it (aws eks update-kubeconfig --alias splitx).
        context: option('--context') ?? 'splitx',
        // Visitors arrive through CloudFront, which alone adds the header the app requires (D-092).
        base: edge.url,
        host: edge.host,
        environment: 'eks',
        otherEnvironment: 'kind',
        // Docker Hub's official image through ECR Public: the nodes share one NAT
        // address, and Docker Hub limits anonymous pulls per address.
        probeImage: 'public.ecr.aws/docker/library/busybox:1.37.0',
        reports: { cluster: 'docs/evidence/kubernetes-eks.md', delivery: 'docs/evidence/delivery-eks.md' },
    };
}

/** The local port in `kubectl port-forward`'s first line, or null before it. */
export function forwardedPort(text) {
    const match = text.match(/Forwarding from 127\.0\.0\.1:(\d+) ->/);
    return match ? Number(match[1]) : null;
}

const forwards = new Set();

/**
 * `kubectl port-forward` to a Service, on a port the system picks. It goes
 * through the API server and the kubelet, so it needs neither a published
 * path nor a security group rule for the control plane (the nodes' group
 * admits it on 443 and 10250 only). Resolves once kubectl is forwarding.
 * @param {{ context: string, namespace: string, service: string, port: number, timeoutMs?: number }} options
 * @returns {Promise<{ port: number, url: string, stop: () => void }>}
 */
export function portForward({ context, namespace, service, port, timeoutMs = 30_000 }) {
    return new Promise((resolve, reject) => {
        const child = spawn('kubectl', ['--context', context, '-n', namespace, 'port-forward', 'svc/' + service, ':' + port], { stdio: ['ignore', 'pipe', 'pipe'] });
        forwards.add(child);
        let said = '';
        let settled = false;
        const settle = (error, value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (error) {
                forwards.delete(child);
                child.kill();
                reject(error);
            } else resolve(value);
        };
        const timer = setTimeout(() => settle(new Error('kubectl port-forward to ' + namespace + '/' + service + ' did not start in ' + timeoutMs / 1000 + ' s: ' + said.trim().slice(0, 200))), timeoutMs);
        child.stdout.on('data', (chunk) => {
            said += chunk;
            const local = forwardedPort(said);
            if (local) {
                settle(null, {
                    port: local,
                    url: 'http://127.0.0.1:' + local,
                    stop: () => {
                        forwards.delete(child);
                        child.kill();
                    },
                });
            }
        });
        child.stderr.on('data', (chunk) => { said += chunk; });
        child.on('error', (error) => settle(error));
        child.on('exit', (code) => {
            forwards.delete(child);
            settle(new Error('kubectl port-forward to ' + namespace + '/' + service + ' ended (' + code + '): ' + said.trim().slice(0, 200)));
        });
    });
}

/** Ends every port-forward still open: a child process outlives a script's exit. */
export function stopForwards() {
    for (const child of forwards) child.kill();
    forwards.clear();
}

/**
 * One key of a Kubernetes Secret, decoded, for the EKS platform, where the
 * External Secrets Operator made it from Secrets Manager (k8s/eks/secrets).
 * Never printed; on GitHub's runners it is masked before anything could print
 * it. Empty when the Secret or the key isn't there.
 * @param {string} context
 * @param {string} namespace
 * @param {string} name
 * @param {string} key
 */
export function clusterSecret(context, namespace, name, key) {
    const result = spawnSync('kubectl', ['--context', context, '-n', namespace, 'get', 'secret', name, '-o', 'json'], { encoding: 'utf8', shell: false });
    let encoded = '';
    try {
        encoded = JSON.parse(result.stdout || '{}').data?.[key] ?? '';
    } catch {
        encoded = '';
    }
    const value = Buffer.from(encoded, 'base64').toString('utf8');
    mask(value);
    return value;
}

/** Asks GitHub Actions to hide a value in the job's log (single-line values). */
function mask(value) {
    if (value && process.env.GITHUB_ACTIONS === 'true') console.log('::add-mask::' + value);
}
