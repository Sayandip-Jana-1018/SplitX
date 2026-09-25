/**
 * Can the application pods open NEW connections?
 *
 * A passing readiness probe does not answer that. Prisma keeps its database
 * connections open, so a pod that already holds one keeps passing readiness
 * while every new connection it tries is dropped — and the next pod the
 * autoscaler starts would never become ready at all.
 *
 * That is exactly the state the Kind cluster fell into (D-044, D-050). New pod
 * connections are queued to the network-policy engine inside kindnetd, which,
 * starved by its resource limits, answered too late for any of them, while
 * established flows passed. The site answered 200.
 *
 * Each check runs inside the pod with busybox tools the image already has.
 */

const REDIS = 'nc -z -w 3 splitx-redis.splitx.svc.cluster.local 6379 >/dev/null 2>&1 && echo redis=ok || echo redis=fail';

const PROBE = [
    'nslookup splitx-postgres.splitx.svc.cluster.local >/dev/null 2>&1 && echo dns=ok || echo dns=fail',
    'nc -z -w 3 splitx-postgres.splitx.svc.cluster.local 5432 >/dev/null 2>&1 && echo postgres=ok || echo postgres=fail',
    REDIS,
].join('; ');

// On EKS the database is outside the cluster (Neon's demo branch, D-091): the
// pod dials the host its own DATABASE_URL names. Node, which the image runs
// on, reads the address; only the host and port reach the shell, and nothing
// of the URL is printed.
export const DATABASE_FROM_URL = 'node -e \'const u = new URL(process.env.DATABASE_URL); process.stdout.write(u.hostname + " " + (u.port || "5432"))\'';
const PROBE_FROM_URL = [
    'set -- $(' + DATABASE_FROM_URL + ' 2>/dev/null)',
    'nslookup "$1" >/dev/null 2>&1 && echo dns=ok || echo dns=fail',
    'nc -z -w 3 "$1" "$2" >/dev/null 2>&1 && echo postgres=ok || echo postgres=fail',
    REDIS,
].join('; ');

/**
 * @param {(argv: string[]) => { code: number, stdout: string }} kubectl  runs kubectl, capturing output
 * @param {string} [namespace]
 * @param {{ database?: 'in-cluster' | 'from-url' }} [options]  where the database is: the
 *   splitx-postgres Service (Kind), or the host in each pod's DATABASE_URL (EKS)
 * @returns {{ pod: string, node: string, dns: boolean, postgres: boolean, redis: boolean, ok: boolean }[]}
 */
export function checkNewConnections(kubectl, namespace = 'splitx', { database = 'in-cluster' } = {}) {
    const list = kubectl(['get', 'pods', '-n', namespace, '-l', 'app.kubernetes.io/name=splitx', '-o', 'json']);
    const pods = JSON.parse(list.stdout || '{"items":[]}').items
        .filter((pod) => pod.status.phase === 'Running' && !pod.metadata.deletionTimestamp);
    const probe = database === 'from-url' ? PROBE_FROM_URL : PROBE;

    return pods.map((pod) => {
        const out = kubectl(['exec', '-n', namespace, pod.metadata.name, '--', 'sh', '-c', probe]).stdout;
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

/**
 * What a pod in another namespace tries (k8s:verify, D-040, D-103). The first
 * is a control it must reach: CoreDNS over TCP, which no policy guards. A
 * refusal after it is then the policy's, not a pod without a network, and a
 * name that doesn't resolve is reported as such, never as refused.
 */
export const PROBE_CONTROL = { name: 'control', host: 'kube-dns.kube-system.svc.cluster.local', port: 53 };

// Everything a default-deny policy guards (k8s/base, k8s/components, k8s/ops,
// jenkins, nexus), by the Service's own port.
const GUARDED = [
    { name: 'app', namespace: 'splitx', service: 'splitx', port: 80 },
    { name: 'postgres', namespace: 'splitx', service: 'splitx-postgres', port: 5432 },
    { name: 'redis', namespace: 'splitx', service: 'splitx-redis', port: 6379 },
    { name: 'ops-api', namespace: 'ops', service: 'ops-api', port: 8080 },
    { name: 'traffic-lab', namespace: 'ops', service: 'traffic-lab', port: 8080 },
    { name: 'jenkins', namespace: 'jenkins', service: 'jenkins', port: 8080 },
    { name: 'nexus', namespace: 'nexus', service: 'nexus', port: 8081 },
];

/**
 * The control, then each guarded Service this cluster has: Postgres only on
 * Kind, ops-api and the lab only with an ops image.
 * @param {Set<string>} services  "namespace/name" of every Service in the cluster
 * @returns {{ name: string, host: string, port: number }[]}
 */
export function policyTargets(services) {
    return [PROBE_CONTROL, ...GUARDED
        .filter((guarded) => services.has(guarded.namespace + '/' + guarded.service))
        .map((guarded) => ({ name: guarded.name, host: guarded.service + '.' + guarded.namespace + '.svc.cluster.local', port: guarded.port }))];
}

/** The probe pod's script: for each target, one line of name=reached, refused or unresolved. */
export function policyProbeScript(targets) {
    return targets.map(({ name, host, port }) => 'if nslookup ' + host + ' >/dev/null 2>&1; then '
        + 'if nc -z -w 5 ' + host + ' ' + port + ' >/dev/null 2>&1; then echo ' + name + '=reached; else echo ' + name + '=refused; fi; '
        + 'else echo ' + name + '=unresolved; fi').join('; ');
}

/**
 * @param {string} log  the probe pod's output
 * @param {{ name: string, host: string, port: number }[]} targets
 */
export function readPolicyProbe(log, targets) {
    return targets.map((target) => ({
        ...target,
        verdict: log.match(new RegExp('^' + target.name + '=(reached|refused|unresolved)\\s*$', 'm'))?.[1] ?? 'no answer',
    }));
}

/** Enforced: the control was reached, and every guarded target was refused. */
export function policyEnforced(results) {
    const [control, ...guarded] = results;
    return control?.name === PROBE_CONTROL.name && control.verdict === 'reached'
        && guarded.length > 0 && guarded.every((result) => result.verdict === 'refused');
}

// Runs inside a Kind node. Finds the kindnet container's cgroup and reads what
// decides whether it keeps up: CPU quota and throttling, memory against its
// limit, and netfilter queue 101, where new pod connections wait for kindnet's
// verdict. Fields of that queue file: 3 waiting now, 6 and 7 dropped by the
// kernel and by userspace, 8 the id of the last packet queued.
const KINDNET_PROBE = `
cid=$(crictl ps --name kindnet-cni -q | head -n 1)
pid=$(crictl inspect --output go-template --template '{{.info.pid}}' "$cid")
cg=/sys/fs/cgroup$(cut -d: -f3 "/proc/$pid/cgroup")
echo "cpu_max=$(cut -d' ' -f1 "$cg/cpu.max")"
awk '$1=="nr_periods"{print "periods=" $2} $1=="nr_throttled"{print "throttled=" $2}' "$cg/cpu.stat"
echo "memory=$(cat "$cg/memory.current")"
echo "memory_peak=$(cat "$cg/memory.peak")"
echo "memory_max=$(cat "$cg/memory.max")"
awk '$1=="max"{print "limit_hits=" $2}' "$cg/memory.events"
awk '$1=="101"{print "waiting=" $3; print "dropped=" ($6 + $7); print "queued=" $8}' /proc/net/netfilter/nfnetlink_queue
`;

/**
 * Is kindnet keeping up with the connections it has to judge (D-050)?
 *
 * @param {(node: string, script: string) => string} exec  runs a shell script in a node container
 * @param {string[]} nodes  Kind node container names
 */
export function kindnetHealth(exec, nodes) {
    return nodes.map((node) => {
        const fields = Object.fromEntries(
            exec(node, KINDNET_PROBE).split(/\r?\n/).filter((line) => line.includes('=')).map((line) => line.trim().split('='))
        );
        const number = (key) => (fields[key] === undefined ? null : Number(fields[key]));
        const result = {
            node,
            cpuQuota: fields.cpu_max ?? null,
            throttled: number('throttled'),
            periods: number('periods'),
            memoryMiB: fields.memory ? Math.round(Number(fields.memory) / 1048576) : null,
            peakMiB: fields.memory_peak ? Math.round(Number(fields.memory_peak) / 1048576) : null,
            limitMiB: fields.memory_max && fields.memory_max !== 'max' ? Math.round(Number(fields.memory_max) / 1048576) : null,
            limitHits: number('limit_hits'),
            waiting: number('waiting') ?? 0,
            queued: number('queued') ?? 0,
            dropped: number('dropped') ?? 0,
        };
        // A healthy engine answers in microseconds, so a snapshot rarely catches
        // more than a packet or two waiting. Hundreds is the failure D-050 found.
        result.ok = result.cpuQuota === 'max' && result.limitHits === 0 && result.dropped === 0 && result.waiting < 10;
        return result;
    });
}

export function describeKindnet(results) {
    return results
        .map((r) => r.node + ': CPU quota ' + r.cpuQuota + ', throttled ' + r.throttled + ' of ' + r.periods + ' periods, memory '
            + r.memoryMiB + ' MiB (peak ' + r.peakMiB + ') of ' + (r.limitMiB ?? 'no limit') + (r.limitMiB ? ' MiB' : '') + ', '
            + r.limitHits + ' limit hits, queue ' + r.waiting + ' waiting of ' + r.queued + ' queued, ' + r.dropped + ' dropped')
        .join('\n');
}
