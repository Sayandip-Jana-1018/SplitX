/**
 * Can the application pods open NEW connections?
 *
 * A passing readiness probe does not answer that. Prisma keeps its database
 * connections open, so a pod that already holds one keeps passing readiness
 * while every new connection it tries is dropped — and the next pod the
 * autoscaler starts would never become ready at all.
 *
 * That is exactly the state a host restart left the Kind cluster in (D-044):
 * node IPs swapped, pod IPs were recycled, and the network-policy engine inside
 * kindnetd kept stale state. New pod connections were queued to it and dropped
 * on the sending node, while established flows passed. The site answered 200.
 *
 * Each check runs inside the pod with busybox tools the image already has.
 */

const PROBE = [
    'nslookup splitx-postgres.splitx.svc.cluster.local >/dev/null 2>&1 && echo dns=ok || echo dns=fail',
    'nc -z -w 3 splitx-postgres.splitx.svc.cluster.local 5432 >/dev/null 2>&1 && echo postgres=ok || echo postgres=fail',
    'nc -z -w 3 splitx-redis.splitx.svc.cluster.local 6379 >/dev/null 2>&1 && echo redis=ok || echo redis=fail',
].join('; ');

/**
 * @param {(argv: string[]) => { code: number, stdout: string }} kubectl  runs kubectl, capturing output
 * @returns {{ pod: string, node: string, dns: boolean, postgres: boolean, redis: boolean, ok: boolean }[]}
 */
export function checkNewConnections(kubectl, namespace = 'splitx') {
    const list = kubectl(['get', 'pods', '-n', namespace, '-l', 'app.kubernetes.io/name=splitx', '-o', 'json']);
    const pods = JSON.parse(list.stdout || '{"items":[]}').items
        .filter((pod) => pod.status.phase === 'Running' && !pod.metadata.deletionTimestamp);

    return pods.map((pod) => {
        const out = kubectl(['exec', '-n', namespace, pod.metadata.name, '--', 'sh', '-c', PROBE]).stdout;
        const result = (name) => new RegExp('^' + name + '=ok$', 'm').test(out);
        const dns = result('dns');
        const postgres = result('postgres');
        const redis = result('redis');
        return { pod: pod.metadata.name, node: pod.spec.nodeName, dns, postgres, redis, ok: dns && postgres && redis };
    });
}

export function describe(results) {
    return results
        .map((r) => r.pod + ' on ' + r.node + ': dns ' + (r.dns ? 'ok' : 'FAIL') + ', postgres ' + (r.postgres ? 'ok' : 'FAIL') + ', redis ' + (r.redis ? 'ok' : 'FAIL'))
        .join('\n');
}
