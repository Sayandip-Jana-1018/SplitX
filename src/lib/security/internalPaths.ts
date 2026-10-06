/**
 * The two paths only the cluster itself may reach (D-043): Prometheus's scrape
 * endpoint, and the readiness probe, which asks the database on every call.
 *
 * On EKS, visitors arrive through SplitX's edge. The load balancer refuses
 * these paths' exact spelling, and the proxy refuses every other spelling of
 * them that came through the edge (D-114, which took this over from
 * CloudFront's edge function).
 */
const INTERNAL_PATHS = new Set(['/api/metrics', '/api/health/ready']);

/**
 * Whether a path is one of the internal ones as the app will route it: escapes
 * decoded, lower case, repeated and trailing slashes removed, so no spelling
 * slips past.
 */
export function isInternalPath(pathname: string): boolean {
    let path = pathname;
    try {
        path = decodeURIComponent(pathname);
    } catch {
        // A malformed escape: the app answers it with 400.
    }
    path = path.toLowerCase().replace(/\/+/g, '/');
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
    return INTERNAL_PATHS.has(path);
}
