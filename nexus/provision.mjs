#!/usr/bin/env node
/**
 * Sets up a fresh Nexus for SplitX's release evidence (D-096), through Nexus'
 * own REST API. Run as the Job in nexus/provision.yaml after every install;
 * safe to run again, because each step first asks whether it is already done.
 *
 *   1. waits until Nexus answers and can write
 *   2. accepts the Community Edition licence: component uploads are refused
 *      until an administrator does. SplitX's owner accepted it for these
 *      instances on 2026-09-24 (docs/DECISIONS.md, D-095 and D-096).
 *   3. turns anonymous access off: nothing is readable without an account
 *   4. creates the raw repository splitx-evidence, where nothing is ever
 *      overwritten (write policy "allow once")
 *   5. creates the role splitx-evidence-writer (read, browse, add and edit, in
 *      that repository only) and the user jenkins with it, whose password
 *      Jenkins holds; a changed password is updated. Jenkins stores with an
 *      HTTP PUT, which Nexus checks as "edit" (D-100); the allow-once policy,
 *      not the role, is what keeps anything from being overwritten
 *   6. when NEXUS_OPS_PASSWORD is set, the same for splitx-evidence-reader
 *      (read only) and the user ops, which ops-api shows the evidence with
 *      on /ops (D-097)
 *   7. proves it: anonymous is refused, Jenkins can browse and store the way
 *      its archive step does but never the same path twice, and ops can't
 *      store; the probes are removed as the admin
 *
 * Needs NEXUS_URL, NEXUS_ADMIN_PASSWORD and NEXUS_JENKINS_PASSWORD. The
 * passwords are never printed; the log names each step and its outcome.
 */

const NEXUS = process.env.NEXUS_URL ?? 'http://nexus.nexus.svc.cluster.local:8081';
const REPOSITORY = 'splitx-evidence';
const ROLE = 'splitx-evidence-writer';
const USER = 'jenkins';

const admin = 'Basic ' + Buffer.from('admin:' + required('NEXUS_ADMIN_PASSWORD')).toString('base64');
const jenkinsPassword = required('NEXUS_JENKINS_PASSWORD');

function required(name) {
    const value = process.env[name];
    if (!value) {
        console.error('x ' + name + ' is not set');
        process.exit(1);
    }
    return value;
}

const say = (text) => console.log('    ' + text);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function api(method, path, body, { auth = admin, type = 'application/json' } = {}) {
    const res = await fetch(NEXUS + '/service/rest' + path, {
        method,
        headers: { ...(auth ? { authorization: auth } : {}), ...(body === undefined ? {} : { 'content-type': type }), accept: 'application/json' },
        body: body === undefined ? undefined : type === 'application/json' ? JSON.stringify(body) : body,
        signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    return { status: res.status, ok: res.ok, json: text && res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : null, text };
}

async function must(what, call) {
    const res = await call;
    if (!res.ok) throw new Error(what + ': HTTP ' + res.status + ' ' + res.text.slice(0, 200));
    return res;
}

// ── 1. ready ─────────────────────────────────────────────────────────────────
console.log('[1] Waiting for Nexus at ' + NEXUS);
const deadline = Date.now() + 15 * 60_000;
for (;;) {
    const res = await api('GET', '/v1/status/writable', undefined, { auth: null }).catch(() => null);
    if (res?.ok) break;
    if (Date.now() > deadline) {
        console.error('x Nexus did not become writable within 15 minutes');
        process.exit(1);
    }
    await sleep(5_000);
}
say('answering, and writable');

// The admin password is set from the Secret at first start
// (NEXUS_SECURITY_INITIAL_PASSWORD). Anything else means this volume holds
// another installation's data, which this Job does not guess its way into.
const whoami = await api('GET', '/v1/security/users?userId=admin');
if (whoami.status === 401) {
    console.error('x the admin password in the Secret is not this Nexus\' admin password');
    process.exit(1);
}

// ── 2. licence ───────────────────────────────────────────────────────────────
console.log('[2] Community Edition licence');
const eula = await must('reading the licence', api('GET', '/v1/system/eula'));
if (eula.json?.accepted) {
    say('already accepted');
} else {
    // Nexus wants its own disclaimer text back, unchanged, with accepted: true.
    await must('accepting the licence', api('POST', '/v1/system/eula', { accepted: true, disclaimer: eula.json?.disclaimer ?? '' }));
    say('accepted, as SplitX\'s owner decided (D-095): ' + (eula.json?.disclaimer ?? '').slice(0, 160));
}

// ── 3. anonymous access ──────────────────────────────────────────────────────
console.log('[3] Anonymous access');
await must('turning anonymous access off', api('PUT', '/v1/security/anonymous', { enabled: false, userId: 'anonymous', realmName: 'NexusAuthorizingRealm' }));
say('off: every request needs an account');

// ── 4. repository ────────────────────────────────────────────────────────────
console.log('[4] Repository ' + REPOSITORY);
const repository = await api('GET', '/v1/repositories/' + REPOSITORY);
if (repository.ok) {
    say('already there');
} else {
    await must('creating the repository', api('POST', '/v1/repositories/raw/hosted', {
        name: REPOSITORY,
        online: true,
        storage: { blobStoreName: 'default', strictContentTypeValidation: false, writePolicy: 'ALLOW_ONCE' },
        raw: { contentDisposition: 'ATTACHMENT' },
    }));
    say('created: raw, stored in the default blob store, and nothing in it is ever overwritten');
}

// ── 5 and 6. roles and users ─────────────────────────────────────────────────
/** A role with these actions on the repository, and one user holding only it. */
async function account({ role: roleId, actions, what, userId, firstName, password }) {
    console.log('    role ' + roleId + ', user ' + userId);
    const privileges = actions.map((action) => `nx-repository-view-raw-${REPOSITORY}-${action}`);
    const role = { id: roleId, name: roleId, description: what + ' in ' + REPOSITORY + ', and nothing else', privileges, roles: [] };
    const existingRole = await api('GET', '/v1/security/roles/' + roleId);
    await must('saving the role ' + roleId, existingRole.ok ? api('PUT', '/v1/security/roles/' + roleId, role) : api('POST', '/v1/security/roles', role));
    say('role ' + (existingRole.ok ? 'updated' : 'created') + ': ' + privileges.join(', '));

    const users = await must('listing users', api('GET', '/v1/security/users?userId=' + userId));
    const [existing] = (users.json ?? []).filter((entry) => entry.userId === userId);
    if (existing) {
        await must('updating the user ' + userId, api('PUT', '/v1/security/users/' + userId, { ...existing, roles: [roleId], status: 'active' }));
        await must('setting ' + userId + '\'s password', api('PUT', '/v1/security/users/' + userId + '/change-password', password, { type: 'text/plain' }));
        say('user updated, with the password from the Secret');
    } else {
        await must('creating the user ' + userId, api('POST', '/v1/security/users', {
            userId,
            firstName,
            lastName: 'SplitX',
            emailAddress: userId + '@splitx.invalid',
            password,
            status: 'active',
            roles: [roleId],
        }));
        say('user created, with the password from the Secret');
    }
}

console.log('[5] Jenkins\' account');
// Nexus checks each request by its HTTP method: POST is "add", PUT is "edit"
// (SecurityFacetSupport.action, Nexus 3.96.3), and Jenkins' archive step stores
// with PUT. With add alone every upload was refused (kind-e2e run 4, D-100).
await account({ role: ROLE, actions: ['read', 'browse', 'add', 'edit'], what: 'Read and store release evidence', userId: USER, firstName: 'Jenkins', password: jenkinsPassword });

const opsPassword = process.env.NEXUS_OPS_PASSWORD;
if (opsPassword) {
    console.log('[6] ops-api\'s account');
    await account({ role: 'splitx-evidence-reader', actions: ['read', 'browse'], what: 'Read release evidence', userId: 'ops', firstName: 'ops-api', password: opsPassword });
} else {
    console.log('[6] ops-api\'s account: no NEXUS_OPS_PASSWORD, so /ops will not show the evidence');
}

// ── check ────────────────────────────────────────────────────────────────────
// Listing the repository's components needs its browse privilege, which the
// role grants (search would also need nx-search-read, which it doesn't).
const asJenkins = 'Basic ' + Buffer.from(USER + ':' + jenkinsPassword).toString('base64');
const anonymous = await api('GET', '/v1/components?repository=' + REPOSITORY, undefined, { auth: null });
const jenkins = await api('GET', '/v1/components?repository=' + REPOSITORY, undefined, { auth: asJenkins });
if (anonymous.ok || !jenkins.ok) {
    console.error('x anonymous read answered ' + anonymous.status + ' (want 401 or 403); jenkins read answered ' + jenkins.status + ' (want 200)');
    process.exit(1);
}

// Storing, as the archive step does it (jenkins/deploy.mjs): a PUT per file.
// A probe per account, under a path /ops never lists (evidence is always
// <commit>/<deployment>/<file>), removed as the admin at once.
const stamp = Date.now();
const probe = (who) => NEXUS + '/repository/' + REPOSITORY + '/provision-check/' + stamp + '-' + who + '.txt';
const put = async (url, auth) => (await fetch(url, {
    method: 'PUT',
    headers: { authorization: auth, 'content-type': 'text/plain' },
    body: 'Stored by nexus/provision.mjs to prove the account can store, and removed by it at once.',
    signal: AbortSignal.timeout(30_000),
})).status;
const succeeded = (status) => status >= 200 && status < 300;
const problems = [];
const stored = [];

const byJenkins = await put(probe('jenkins'), asJenkins);
if (byJenkins === 201) {
    stored.push(probe('jenkins'));
    const again = await put(probe('jenkins'), asJenkins);
    if (succeeded(again)) problems.push('the same path was stored twice (HTTP ' + again + '): the repository must allow each path once');
} else {
    problems.push('Jenkins\' account can\'t store evidence: Nexus answered ' + byJenkins + ' to a PUT, which it checks as edit');
}
let byOps = null;
if (opsPassword) {
    byOps = await put(probe('ops'), 'Basic ' + Buffer.from('ops:' + opsPassword).toString('base64'));
    if (succeeded(byOps)) {
        stored.push(probe('ops'));
        problems.push('ops-api\'s account could store (HTTP ' + byOps + '): it must only read');
    }
}
for (const url of stored) {
    const removed = await fetch(url, { method: 'DELETE', headers: { authorization: admin }, signal: AbortSignal.timeout(30_000) });
    if (removed.status !== 204) say('the probe ' + url.slice(url.indexOf('/repository/')) + ' is still there (HTTP ' + removed.status + '); /ops never lists it');
}
if (problems.length) {
    for (const problem of problems) console.error('x ' + problem);
    process.exit(1);
}
console.log('\nNexus is ready: anonymous ' + anonymous.status + ', jenkins ' + jenkins.status + ' on ' + REPOSITORY
    + '; Jenkins stored a file (201) and could not store it again' + (byOps === null ? '' : '; ops could not store (' + byOps + ')') + '.');
