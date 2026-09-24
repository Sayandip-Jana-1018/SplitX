import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { opsViewer } = vi.hoisted(() => ({ opsViewer: vi.fn() }));
vi.mock('@/lib/ops/access', () => ({ opsViewer }));

const { GET } = await import('@/app/api/ops/summary/route');
const { forgetReadings } = await import('@/lib/ops/reading');

const summary = () => GET(new Request('https://splitx.example/api/ops/summary'));

beforeEach(() => {
    forgetReadings();
    vi.stubEnv('NEXTAUTH_URL', 'https://splitx.example');
    vi.stubEnv('OPS_GITHUB_TOKEN', '');
    vi.stubEnv('SONAR_PROJECT_KEY', '');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })));
});
afterEach(() => {
    vi.resetAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
});

describe('GET /api/ops/summary', () => {
    it('answers 401 to someone signed out and 403 to someone who is not an operator, reading nothing', async () => {
        opsViewer.mockResolvedValue(null);
        expect((await summary()).status).toBe(401);

        opsViewer.mockResolvedValue({ allowed: false, identities: ['google:555'] });
        expect((await summary()).status).toBe(403);

        expect(fetch).not.toHaveBeenCalled();
    });

    it('gives an operator every reading, each saying where it came from, and unavailable where it is', async () => {
        opsViewer.mockResolvedValue({ allowed: true, identities: ['github:12345678'] });

        const res = await summary();
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(res.headers.get('Cache-Control')).toBe('no-store');
        expect(body.site).toBe('https://splitx.example');
        for (const key of ['pipeline', 'codeScanning', 'dependabot', 'deliveries', 'qualityGate']) {
            expect(body[key]).toMatchObject({ ok: false, source: expect.any(String), fetchedAt: expect.any(String), error: expect.any(String) });
        }
        expect(body.pipeline.error).toBe('OPS_GITHUB_TOKEN is not set');
        // The cluster half has its own route, read more often (/api/ops/cluster, D-097).
        expect(body).not.toHaveProperty('cluster');
    });
});
