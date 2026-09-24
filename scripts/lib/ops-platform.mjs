/**
 * ops-api and the traffic lab (k8s/ops, D-097) on either cluster: what
 * cluster-up writes for them, and k8s/ops with the release's ops image pinned
 * by digest, the way the app's image is. Pure where it can be, so the unit
 * tests check what reaches the cluster (tests/unit/infra/opsApi.test.ts).
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** The traffic lab's one target: an origin, never a path (ops/lab/server.mjs checks it too). */
const ORIGIN = /^https?:\/\/[a-z0-9.-]+(:\d+)?$/i;

/**
 * The two ConfigMaps in `ops`: the platform's facts, which ops-api reads as
 * environment variables and shows on /ops, and the traffic lab's target.
 * @param {{ facts: Record<string, string | undefined>, target: string }} options
 */
export function opsConfigMaps({ facts, target }) {
    if (!ORIGIN.test(target)) throw new Error('the traffic lab\'s target must be an http(s) origin, not ' + target);
    const labels = { 'app.kubernetes.io/part-of': 'splitx' };
    const data = Object.fromEntries(Object.entries(facts).filter(([, value]) => value !== undefined && value !== '').map(([key, value]) => [key, String(value)]));
    return {
        apiVersion: 'v1',
        kind: 'List',
        items: [
            { apiVersion: 'v1', kind: 'ConfigMap', metadata: { name: 'platform-facts', namespace: 'ops', labels }, data },
            { apiVersion: 'v1', kind: 'ConfigMap', metadata: { name: 'traffic-lab', namespace: 'ops', labels }, data: { target } },
        ],
    };
}

/**
 * A kustomization over k8s/ops that runs the given ops image, from our
 * registry and by digest only.
 * @param {string} image  ghcr.io/sayandip-jana-1018/splitx@sha256:<digest>
 */
export function opsKustomization(image) {
    const match = String(image).match(/^(ghcr\.io\/sayandip-jana-1018\/splitx)@(sha256:[0-9a-f]{64})$/);
    if (!match) throw new Error('the ops image must be ghcr.io/sayandip-jana-1018/splitx@sha256:<digest>, not ' + image);
    const [, name, digest] = match;
    return {
        apiVersion: 'kustomize.config.k8s.io/v1beta1',
        kind: 'Kustomization',
        resources: ['../k8s/ops'],
        images: [{ name: 'splitx-ops', newName: name, digest }],
    };
}

/**
 * Applies both, then waits for the two deployments.
 * @param {{ root: string, kubectl: (argv: string[], options?: object) => { stdout: string }, image: string,
 *           facts: Record<string, string | undefined>, target: string }} options
 */
export function applyOps({ root, kubectl, image, facts, target }) {
    const kustomization = opsKustomization(image);
    const configured = kubectl(['apply', '-f', '-'], { input: JSON.stringify(opsConfigMaps({ facts, target })), capture: true });
    const work = mkdtempSync(join(root, '.cluster-up-ops-'));
    let applied;
    try {
        writeFileSync(join(work, 'kustomization.yaml'), JSON.stringify(kustomization, null, 2));
        applied = kubectl(['apply', '-k', work], { capture: true });
    } finally {
        rmSync(work, { recursive: true, force: true });
    }
    // A changed ConfigMap reaches a running pod only when it starts again; a
    // new image or a new Deployment starts pods of its own.
    const podsChanged = /deployment\.apps\/\S+ (created|configured)/.test(applied.stdout);
    if (configured.stdout.includes('configured') && !podsChanged) {
        kubectl(['-n', 'ops', 'rollout', 'restart', 'deployment/ops-api', 'deployment/traffic-lab'], { capture: true });
    }
    kubectl(['-n', 'ops', 'rollout', 'status', 'deployment/ops-api', '--timeout=240s']);
    kubectl(['-n', 'ops', 'rollout', 'status', 'deployment/traffic-lab', '--timeout=240s']);
}
