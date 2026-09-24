import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { opsViewer } = vi.hoisted(() => ({ opsViewer: vi.fn() }));
vi.mock('@/lib/ops/access', () => ({ opsViewer }));

const { CLUSTER_KEYS, opsApiUrl, readCluster } = await import('@/lib/ops/cluster');
const { forgetReadings } = await import('@/lib/ops/reading');
const clusterRoute = await import('@/app/api/ops/cluster/route');
const trafficRoute = await import('@/app/api/ops/traffic/route');

/*
 * The cluster half of /ops (D-097): the app reads ops-api, never the cluster
 * itself, and only an operator may read it or start the traffic lab.
 */

const OPS_API = 'http://ops-api.ops.svc.cluster.local:8080';
const operator = { allowed: true, identities: ['github:12345678'] };
const reading = (data: unknown) => ({ ok: true, source: 'a source', fetchedAt: '2026-09-24T10:00:00.000Z', data });
const everyReading = () => Object.fromEntries(CLUSTER_KEYS.map((key) => [key, reading([])]));

const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const start = (body: unknown, headers: Record<string, string> = { 'content-type': 'application/json' }) =>
    trafficRoute.POST(new Request('https://splitx.example/api/ops/traffic', { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) }));

beforeEach(() => {
    forgetReadings();
    vi.stubEnv('OPS_API_URL', OPS_API);
    vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
    vi.resetAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
});

describe('where ops-api is', () => {
    it('is an http(s) origin from OPS_API_URL, or nowhere', () => {
        expect(opsApiUrl('http://ops-api.ops.svc.cluster.local:8080/ignored')).toBe(OPS_API);
        expect(opsApiUrl('')).toBeNull();
        expect(opsApiUrl('file:///etc/passwd')).toBeNull();
        expect(opsApiUrl('not a url')).toBeNull();
    });
});

describe('reading the cluster', () => {
    it('says "not connected" where there is no cluster, and calls nothing', async () => {
        vi.stubEnv('OPS_API_URL', '');
        const result = await readCluster();
        expect(result).toMatchObject({ ok: false, source: 'ops-api in the cluster', error: expect.stringMatching(/Not connected here/) });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('passes on exactly the readings the page knows, as ops-api gave them', async () => {
        fetchMock.mockResolvedValue(json({ ...everyReading(), secretThing: reading('never shown') }));
        const result = await readCluster();
        expect(fetchMock).toHaveBeenCalledWith(`${OPS_API}/v1/readings`, expect.objectContaining({ cache: 'no-store' }));
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(Object.keys(result.data).sort()).toEqual([...CLUSTER_KEYS].sort());
        expect(result.data).not.toHaveProperty('secretThing');
    });

    it('reports an answer it can\'t use, or no answer, as unavailable with the reason', async () => {
        const { nodes: _dropped, ...partial } = everyReading();
        void _dropped;
        fetchMock.mockResolvedValueOnce(json(partial));
        expect(await readCluster()).toMatchObject({ ok: false, error: 'ops-api\'s answer has no reading for nodes' });

        forgetReadings();
        fetchMock.mockResolvedValueOnce(json({}, 503));
        expect(await readCluster()).toMatchObject({ ok: false, error: 'ops-api answered 503' });

        forgetReadings();
        fetchMock.mockRejectedValueOnce(Object.assign(new Error('aborted'), { name: 'TimeoutError' }));
        expect(await readCluster()).toMatchObject({ ok: false, error: 'it did not answer in time' });
    });

    it('reads ops-api once for however many pages are open', async () => {
        fetchMock.mockResolvedValue(json(everyReading()));
        await Promise.all([readCluster(), readCluster(), readCluster()]);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});

describe('GET /api/ops/cluster', () => {
    it('answers 401 to someone signed out and 403 to someone who is not an operator, reading nothing', async () => {
        opsViewer.mockResolvedValue(null);
        expect((await clusterRoute.GET()).status).toBe(401);
        opsViewer.mockResolvedValue({ allowed: false, identities: ['google:555'] });
        expect((await clusterRoute.GET()).status).toBe(403);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('gives an operator the cluster\'s readings, never cached', async () => {
        opsViewer.mockResolvedValue(operator);
        fetchMock.mockResolvedValue(json(everyReading()));
        const res = await clusterRoute.GET();
        expect(res.status).toBe(200);
        expect(res.headers.get('Cache-Control')).toBe('no-store');
        expect((await res.json()).cluster).toMatchObject({ ok: true, source: 'ops-api in the cluster' });
    });
});

describe('the traffic lab\'s buttons', () => {
    it('are for operators only', async () => {
        opsViewer.mockResolvedValue(null);
        expect((await start({ rate: 20, seconds: 120 })).status).toBe(401);
        opsViewer.mockResolvedValue({ allowed: false, identities: [] });
        expect((await start({ rate: 20, seconds: 120 })).status).toBe(403);
        expect((await trafficRoute.DELETE()).status).toBe(403);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('take only JSON within the lab\'s limits, and no other setting such as a target', async () => {
        opsViewer.mockResolvedValue(operator);
        expect((await start('rate=30&seconds=180', { 'content-type': 'application/x-www-form-urlencoded' })).status).toBe(415);
        expect((await start('{not json')).status).toBe(400);
        for (const body of [{ rate: 31, seconds: 60 }, { rate: 10, seconds: 181 }, { rate: 1.5, seconds: 60 }, { rate: 10, seconds: 60, target: 'https://example.com' }, {}]) {
            expect((await start(body)).status, JSON.stringify(body)).toBe(400);
        }
        expect((await start('x'.repeat(2000))).status).toBe(413);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('ask ops-api to start and stop the run, and pass on what the lab said', async () => {
        opsViewer.mockResolvedValue(operator);
        fetchMock.mockResolvedValueOnce(json({ state: 'running', rate: 30, seconds: 180, target: 'https://d1.cloudfront.net' }, 202));
        const started = await start({ rate: 30, seconds: 180 });
        expect(started.status).toBe(202);
        expect(await started.json()).toMatchObject({ state: 'running', rate: 30 });
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe(`${OPS_API}/v1/traffic`);
        expect(init).toMatchObject({ method: 'POST', body: JSON.stringify({ rate: 30, seconds: 180 }) });

        fetchMock.mockResolvedValueOnce(json({ error: 'a run is already going; stop it first' }, 409));
        expect((await start({ rate: 10, seconds: 60 })).status).toBe(409);

        fetchMock.mockResolvedValueOnce(json({ state: 'stopping' }, 202));
        const stopped = await trafficRoute.DELETE();
        expect(stopped.status).toBe(202);
        expect(fetchMock.mock.calls[2][1]).toMatchObject({ method: 'DELETE' });
    });

    it('say so when ops-api can\'t be reached, or when there is no cluster at all', async () => {
        opsViewer.mockResolvedValue(operator);
        fetchMock.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));
        const unreachable = await start({ rate: 20, seconds: 120 });
        expect(unreachable.status).toBe(502);
        expect((await unreachable.json()).error).toMatch(/could not be reached/);

        vi.stubEnv('OPS_API_URL', '');
        const nowhere = await trafficRoute.DELETE();
        expect(nowhere.status).toBe(503);
        expect((await nowhere.json()).error).toMatch(/Not connected here/);
    });
});
