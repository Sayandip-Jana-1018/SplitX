import { spawn } from 'node:child_process';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/*
 * nexus/provision.mjs sets up every fresh Nexus (D-096). It runs against a
 * small stand-in for Nexus' REST API here: the requests it makes are the
 * ones the real API documents, and a second run must change nothing but
 * Jenkins' password.
 */

const ADMIN = 'admin-secret';
const JENKINS = 'jenkins-secret';
const DISCLAIMER = 'Use of Sonatype Nexus Repository - Community Edition is governed by the End User License Agreement at https://links.sonatype.com/products/nxrm/ce-eula.';

interface FakeNexus {
    eula: boolean;
    anonymous: boolean;
    repositories: Map<string, Record<string, unknown>>;
    roles: Map<string, Record<string, unknown>>;
    users: Map<string, Record<string, unknown> & { password?: string }>;
    requests: string[];
    eulaAccepts: unknown[];
}

let server: Server;
let base: string;
let nexus: FakeNexus;

const basic = (user: string, password: string) => 'Basic ' + Buffer.from(user + ':' + password).toString('base64');

async function body(req: IncomingMessage): Promise<string> {
    let text = '';
    for await (const chunk of req) text += chunk;
    return text;
}

beforeEach(async () => {
    nexus = { eula: false, anonymous: true, repositories: new Map(), roles: new Map(), users: new Map(), requests: [], eulaAccepts: [] };
    server = createServer(async (req, res) => {
        const url = new URL(req.url ?? '/', 'http://nexus');
        const path = url.pathname.replace('/service/rest', '');
        nexus.requests.push(req.method + ' ' + path);
        const send = (status: number, value?: unknown) => {
            res.writeHead(status, value === undefined ? {} : { 'content-type': 'application/json' });
            res.end(value === undefined ? '' : JSON.stringify(value));
        };
        const auth = req.headers.authorization;
        if (path === '/v1/status/writable') return send(200);
        if (path === '/v1/components') {
            const jenkins = nexus.users.get('jenkins');
            if (auth === basic('jenkins', jenkins?.password ?? '') && (nexus.roles.get('splitx-evidence-writer')?.privileges as string[]).includes('nx-repository-view-raw-splitx-evidence-browse')) {
                return send(200, { items: [] });
            }
            return send(nexus.anonymous && !auth ? 200 : 401);
        }
        if (auth !== basic('admin', ADMIN)) return send(401);
        const text = await body(req);
        if (path === '/v1/security/users' && req.method === 'GET') {
            const id = url.searchParams.get('userId') ?? '';
            return send(200, [...nexus.users.values()].filter((user) => String(user.userId).startsWith(id)).map((user) => ({ ...user, password: undefined })));
        }
        if (path === '/v1/system/eula' && req.method === 'GET') return send(200, { accepted: nexus.eula, disclaimer: DISCLAIMER });
        if (path === '/v1/system/eula' && req.method === 'POST') {
            const answer = JSON.parse(text);
            nexus.eulaAccepts.push(answer);
            if (answer.disclaimer !== DISCLAIMER) return send(400);
            nexus.eula = answer.accepted === true;
            return send(204);
        }
        if (path === '/v1/security/anonymous' && req.method === 'PUT') {
            nexus.anonymous = JSON.parse(text).enabled;
            return send(200, JSON.parse(text));
        }
        if (path.startsWith('/v1/repositories/') && req.method === 'GET') {
            const repository = nexus.repositories.get(path.split('/').pop()!);
            return repository ? send(200, repository) : send(404);
        }
        if (path === '/v1/repositories/raw/hosted' && req.method === 'POST') {
            const repository = JSON.parse(text);
            nexus.repositories.set(repository.name, repository);
            return send(201);
        }
        if (path.startsWith('/v1/security/roles')) {
            if (req.method === 'GET') {
                const role = nexus.roles.get(path.split('/').pop()!);
                return role ? send(200, role) : send(404);
            }
            const role = JSON.parse(text);
            nexus.roles.set(role.id, role);
            return send(req.method === 'POST' ? 200 : 204);
        }
        if (path === '/v1/security/users' && req.method === 'POST') {
            const user = JSON.parse(text);
            nexus.users.set(user.userId, user);
            return send(200, { ...user, password: undefined });
        }
        const password = path.match(/^\/v1\/security\/users\/([^/]+)\/change-password$/);
        if (password && req.method === 'PUT') {
            nexus.users.get(password[1])!.password = text;
            return send(204);
        }
        const user = path.match(/^\/v1\/security\/users\/([^/]+)$/);
        if (user && req.method === 'PUT') {
            const existing = nexus.users.get(user[1])!;
            nexus.users.set(user[1], { ...existing, ...JSON.parse(text), password: existing.password });
            return send(204);
        }
        return send(404);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
});

afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
});

function provision(env: Record<string, string> = {}): Promise<{ code: number | null; output: string }> {
    return new Promise((resolve) => {
        const childEnv: NodeJS.ProcessEnv = {
            PATH: process.env.PATH,
            NODE_ENV: 'test',
            NEXUS_URL: base,
            NEXUS_ADMIN_PASSWORD: ADMIN,
            NEXUS_JENKINS_PASSWORD: JENKINS,
            ...env,
        };
        const child = spawn(process.execPath, ['nexus/provision.mjs'], { env: childEnv });
        let output = '';
        child.stdout.on('data', (chunk) => { output += chunk; });
        child.stderr.on('data', (chunk) => { output += chunk; });
        child.on('close', (code) => resolve({ code, output }));
    });
}

describe('setting up a fresh Nexus', () => {
    it('accepts the licence with Nexus\' own words, closes anonymous access, and makes the repository and Jenkins\' account', async () => {
        const { code, output } = await provision();

        expect(code).toBe(0);
        expect(nexus.eulaAccepts).toEqual([{ accepted: true, disclaimer: DISCLAIMER }]);
        expect(nexus.anonymous).toBe(false);
        expect(nexus.repositories.get('splitx-evidence')).toMatchObject({ online: true, storage: { writePolicy: 'ALLOW_ONCE' } });
        expect(nexus.roles.get('splitx-evidence-writer')?.privileges).toEqual([
            'nx-repository-view-raw-splitx-evidence-read',
            'nx-repository-view-raw-splitx-evidence-browse',
            'nx-repository-view-raw-splitx-evidence-add',
        ]);
        expect(nexus.users.get('jenkins')).toMatchObject({ roles: ['splitx-evidence-writer'], status: 'active', password: JENKINS });
        expect(output).not.toContain(ADMIN);
        expect(output).not.toContain(JENKINS);
    });

    it('changes nothing the second time but Jenkins\' password', async () => {
        await provision();
        nexus.requests = [];
        const { code } = await provision({ NEXUS_JENKINS_PASSWORD: 'rotated' });

        expect(code).toBe(0);
        expect(nexus.eulaAccepts).toHaveLength(1);
        expect(nexus.requests).not.toContain('POST /v1/repositories/raw/hosted');
        expect(nexus.requests).not.toContain('POST /v1/security/users');
        expect(nexus.users.get('jenkins')?.password).toBe('rotated');
    });

    it('stops when the admin password is not this Nexus\' (another installation\'s volume)', async () => {
        const { code, output } = await provision({ NEXUS_ADMIN_PASSWORD: 'wrong' });

        expect(code).toBe(1);
        expect(output).toContain('not this Nexus');
        expect(nexus.eulaAccepts).toHaveLength(0);
    });

    it('refuses to start without its passwords', async () => {
        const { code, output } = await provision({ NEXUS_JENKINS_PASSWORD: '' });
        expect(code).toBe(1);
        expect(output).toContain('NEXUS_JENKINS_PASSWORD is not set');
    });
});
