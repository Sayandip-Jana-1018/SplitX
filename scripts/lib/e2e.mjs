/**
 * The Kind end-to-end run on GitHub's runners (kind-e2e.yml, D-099): the parts
 * that decide something, kept free of I/O so the unit tests can hold them to it.
 */
import { randomBytes } from 'node:crypto';

/**
 * Values a run makes for itself. Nobody needs to choose them and they live
 * only as long as the runner: the database, Redis, Grafana, Jenkins and Nexus
 * passwords, the app's session secret, the metrics token, and the token the
 * relay shows Jenkins.
 */
const GENERATED = [
    'NEXTAUTH_SECRET',
    'POSTGRES_PASSWORD',
    'REDIS_PASSWORD',
    'METRICS_TOKEN',
    'GF_ADMIN_PASSWORD',
    'JENKINS_ADMIN_PASSWORD',
    'JENKINS_TRIGGER_TOKEN',
    'NEXUS_ADMIN_PASSWORD',
    'NEXUS_JENKINS_PASSWORD',
    'NEXUS_OPS_PASSWORD',
];

/**
 * Values that belong to something outside the run, so they come from the
 * repository: the smee.io channel the repository's webhook posts to and that
 * webhook's secret (without them GitHub's own delivery can't reach this
 * cluster), and a token Jenkins reads and reports on deployments with (the
 * job's GITHUB_TOKEN).
 */
export const FROM_REPOSITORY = ['SMEE_URL', 'GITHUB_WEBHOOK_SECRET', 'JENKINS_GITHUB_TOKEN'];

/** Passed on when the repository has them: Alertmanager then emails what fires. */
export const OPTIONAL = ['ALERT_SMTP_USERNAME', 'ALERT_SMTP_PASSWORD', 'ALERT_EMAIL_TO'];

/**
 * The operator ops-verify signs in as. It exists only in this run's throwaway
 * database; OPS_ADMINS names it, as it names real operators on Vercel.
 */
export const E2E_OPERATOR = {
    userId: 'e2e-operator',
    email: 'operator@e2e.splitx.invalid',
    name: 'End-to-end operator',
    provider: 'github',
    accountId: 'e2e-operator',
};

/** A signed-in account that is not an operator, to prove /ops refuses it. */
export const E2E_VISITOR = { userId: 'e2e-visitor', email: 'visitor@e2e.splitx.invalid', name: 'End-to-end visitor' };

/**
 * The session cookie a production build reads (src/lib/sessionCookie.ts), and
 * the cluster runs a production build. next-auth salts the token with the
 * cookie's name, so a session made for the development name is no session
 * there: run 4 got 401 for its operator (D-100).
 */
export const E2E_SESSION_COOKIE = '__Secure-authjs.session-token';

/**
 * A Cookie header holding a session for `person`, as the app issues one at
 * sign-in: signed with the run's own secret, for an hour.
 *
 * @param {typeof import('next-auth/jwt').encode} encode next-auth/jwt's encode
 */
export async function e2eSessionCookie(encode, person, secret) {
    const token = await encode({
        token: { id: person.userId, sub: person.userId, email: person.email, name: person.name, tokenVersion: 0 },
        secret,
        salt: E2E_SESSION_COOKIE,
        maxAge: 3600,
    });
    return E2E_SESSION_COOKIE + '=' + token;
}

/**
 * ops-api's readings (src/lib/ops/cluster.ts, CLUSTER_KEYS), by what a Kind
 * cluster can give them: its own sources, or nothing, because only the EKS
 * platform gives ops-api an AWS role. A unit test keeps the two lists
 * covering every reading exactly once.
 */
export const READINGS_ON_KIND = ['nodes', 'workloads', 'servingPods', 'autoscaler', 'traffic', 'admissions', 'alerts', 'logs', 'delivery', 'evidence', 'lab', 'platform'];
export const READINGS_ON_AWS_ONLY = ['stacks', 'eks', 'edge', 'budget'];

const secret = () => randomBytes(24).toString('base64url');

/**
 * The run's .env values, and which repository values are missing. Nothing
 * is read from anywhere but `source` (the job's environment).
 *
 * @param {Record<string, string | undefined>} source
 * @param {(key: string) => string} [make] makes one generated value
 */
export function e2eEnvironment(source, make = secret) {
    const values = Object.fromEntries(GENERATED.map((key) => [key, make(key)]));
    const missing = FROM_REPOSITORY.filter((key) => !source[key]);
    for (const key of [...FROM_REPOSITORY, ...OPTIONAL]) if (source[key]) values[key] = source[key];
    values.OPS_ADMINS = E2E_OPERATOR.provider + ':' + E2E_OPERATOR.accountId;
    return { values, missing };
}

/** One .env line; a value with anything but plain token characters is double-quoted. */
export function envLine(key, value) {
    if (/[\r\n]/.test(value)) throw new Error(key + ' holds a line break, which .env can not carry');
    return key + '=' + (/^[\w@.:/+=,-]*$/.test(value) ? value : JSON.stringify(value));
}

const DIGEST_REF = /^ghcr\.io\/sayandip-jana-1018\/splitx@sha256:[0-9a-f]{64}$/;

/**
 * The release to run: a `kind` deployment the release job created, whose
 * payload names both signed images by digest. The newest one, or the one for
 * `sha` when a commit is asked for.
 */
export function pickRelease(deployments, sha = '') {
    const releases = deployments.filter((deployment) =>
        deployment.environment === 'kind'
        && deployment.creator?.login === 'github-actions[bot]'
        && DIGEST_REF.test(deployment.payload?.image ?? '')
        && DIGEST_REF.test(deployment.payload?.ops_image ?? ''));
    const release = sha ? releases.find((deployment) => deployment.sha.startsWith(sha)) : releases[0];
    if (!release) return null;
    return { sha: release.sha, image: release.payload.image, opsImage: release.payload.ops_image, announcedBy: release.id };
}

/**
 * What the relay's log (jenkins/relay/relay.mjs, one JSON object a line) says
 * about deployment deliveries: none yet, all accepted, or one refused and why.
 * A form-encoded webhook is the refusal the first runs met (D-099): GitHub
 * signs the form's bytes, the relay hands Jenkins JSON, and Jenkins refuses
 * the signature, as it should.
 */
export function relayVerdict(logText) {
    const lines = logText.split('\n').flatMap((line) => {
        try {
            return [JSON.parse(line)];
        } catch {
            return [];
        }
    });
    const relayed = lines.filter((line) => line.msg === 'delivery relayed' && line.event === 'deployment');
    const refused = relayed.find((line) => line.result !== 'accepted');
    if (!refused) return { refused: false, said: relayed.length ? relayed.length + ' deployment delivery(ies) accepted by Jenkins' : 'no deployment delivery yet' };
    const formEncoded = lines.find((line) => line.msg === 'the webhook must send application/json');
    return {
        refused: true,
        said: formEncoded
            ? 'the repository webhook sends ' + formEncoded.contentType + ', so GitHub\'s signature can\'t survive the relay and Jenkins refused it (HTTP '
                + refused.status + '): set the webhook\'s Content type to application/json'
            : 'Jenkins answered HTTP ' + refused.status + ' to GitHub\'s delivery (' + refused.result + ')',
    };
}

/**
 * Where a delivery stands, from its statuses (newest first, as GitHub lists
 * them): done, failed, or still waiting, and what the deployer last said.
 */
export function deliveryState(statuses) {
    const [newest] = statuses;
    if (!newest) return { done: false, ok: false, state: 'none', said: 'no status yet: the webhook has not reached Jenkins, or its build has not started' };
    const said = newest.description ?? '';
    if (newest.state === 'success') return { done: true, ok: true, state: newest.state, said };
    if (['failure', 'error', 'inactive'].includes(newest.state)) return { done: true, ok: false, state: newest.state, said };
    return { done: false, ok: false, state: newest.state, said };
}
