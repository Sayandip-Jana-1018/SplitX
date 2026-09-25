/**
 * What `cluster-up --target eks` reads from the repository before it touches
 * the cluster, kept apart so the unit tests can check the committed files
 * agree with each other (tests/unit/infra/eksPlatform.test.ts).
 */

/** The placeholder k8s/overlays/aws carries until terraform/edge exists. */
const EDGE_PLACEHOLDER = 'REPLACE_WITH_PUBLIC_HOSTNAME';

/**
 * The edge's address as the AWS overlay commits it (NEXTAUTH_URL), or null
 * while it is still the placeholder.
 * @param {string} kustomization  k8s/overlays/aws/kustomization.yaml
 * @returns {{ url: string, host: string } | null}
 */
export function committedEdge(kustomization) {
    const match = kustomization.match(/^\s*-\s*NEXTAUTH_URL=(\S+)\s*$/m);
    if (!match) throw new Error('k8s/overlays/aws/kustomization.yaml sets no NEXTAUTH_URL');
    const url = new URL(match[1]);
    if (url.hostname === EDGE_PLACEHOLDER.toLowerCase()) return null;
    if (url.protocol !== 'https:' || url.pathname !== '/' || url.search) {
        throw new Error(`NEXTAUTH_URL in k8s/overlays/aws must be https://<host> and nothing more, not ${match[1]}`);
    }
    return { url: `https://${url.hostname}`, host: url.hostname };
}

/**
 * The region the ClusterSecretStore reads from (k8s/eks/secrets/clustersecretstore.yaml).
 * @param {string} store
 */
export function storeRegion(store) {
    const match = store.match(/^\s+region:\s*([a-z0-9-]+)\s*$/m);
    if (!match) throw new Error('k8s/eks/secrets/clustersecretstore.yaml names no region');
    return match[1];
}

/**
 * The CloudFront prefix list the load balancer admits
 * (alb.ingress.kubernetes.io/security-group-prefix-lists in the AWS overlay).
 * @param {string} ingressPatch  k8s/overlays/aws/patches/ingress.yaml
 */
export function admittedPrefixList(ingressPatch) {
    const match = ingressPatch.match(/alb\.ingress\.kubernetes\.io\/security-group-prefix-lists:\s*"?(pl-[0-9a-f]+)"?/);
    if (!match) throw new Error('k8s/overlays/aws/patches/ingress.yaml admits no prefix list');
    return match[1];
}

/**
 * The image to run, when one is given: our registry, by digest, never a tag.
 * @param {string} image
 */
export function releaseImage(image) {
    const match = image.match(/^(ghcr\.io\/sayandip-jana-1018\/splitx)@(sha256:[0-9a-f]{64})$/);
    if (!match) throw new Error(`--image must be ghcr.io/sayandip-jana-1018/splitx@sha256:<digest>, not ${image}`);
    return { name: match[1], digest: match[2] };
}
