import { afterEach, describe, expect, it } from 'vitest';
import { CONTENT_SECURITY_POLICY, parseCspReports, PERMISSIONS_POLICY } from '@/lib/security/contentSecurityPolicy';
import { metrics } from '@/lib/metrics';

const { POST } = await import('@/app/api/csp-report/route');

const directives = new Map(CONTENT_SECURITY_POLICY.split('; ').map((part) => {
    const [name, ...values] = part.split(' ');
    return [name, values];
}));

describe('the policy', () => {
    it('never allows eval, plugins, framing, or a different base or form target', () => {
        expect(CONTENT_SECURITY_POLICY).not.toContain("'unsafe-eval'");
        expect(directives.get('object-src')).toEqual(["'none'"]);
        expect(directives.get('frame-ancestors')).toEqual(["'none'"]);
        expect(directives.get('base-uri')).toEqual(["'self'"]);
        expect(directives.get('form-action')).toEqual(["'self'"]);
    });

    it('lets requests go only to the site and its photo storage', () => {
        expect(directives.get('connect-src')).toEqual(["'self'", 'https://*.supabase.co']);
        expect(directives.get('default-src')).toEqual(["'self'"]);
    });

    it('runs scripts and workers from the site alone: the OCR engine is served from it too', () => {
        expect(directives.get('script-src')).toEqual(["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'"]);
        expect(directives.get('worker-src')).toEqual(["'self'"]);
    });

    it('lets the site itself, and nothing else, use the camera and microphone', () => {
        expect(PERMISSIONS_POLICY).toContain('camera=(self)');
        expect(PERMISSIONS_POLICY).toContain('microphone=(self)');
        expect(PERMISSIONS_POLICY).toContain('geolocation=()');
    });
});

describe('parseCspReports', () => {
    it('reads the older application/csp-report format', () => {
        expect(parseCspReports({
            'csp-report': {
                'document-uri': 'https://splitx.example/dashboard?tab=1',
                'violated-directive': 'script-src-elem',
                'blocked-uri': 'https://evil.example/x.js',
            },
        })).toEqual([{ directive: 'script-src-elem', source: 'external', blockedOrigin: 'https://evil.example', page: '/dashboard' }]);
    });

    it('reads the Reporting API format and classifies inline, eval and same-site sources', () => {
        const parsed = parseCspReports([
            { type: 'csp-violation', body: { documentURL: 'https://splitx.example/', effectiveDirective: 'script-src-elem', blockedURL: 'inline' } },
            { type: 'csp-violation', body: { documentURL: 'https://splitx.example/', effectiveDirective: 'script-src', blockedURL: 'eval' } },
            { type: 'csp-violation', body: { documentURL: 'https://splitx.example/', effectiveDirective: 'img-src', blockedURL: 'https://splitx.example/a.png' } },
            { type: 'deprecation', body: {} },
        ]);
        expect(parsed.map((violation) => violation.source)).toEqual(['inline', 'eval', 'self']);
    });

    it('keeps labels to a fixed set whatever a report claims', () => {
        const [violation] = parseCspReports({ 'csp-report': { 'violated-directive': 'made-up-directive <script>', 'blocked-uri': 'not a url' } });
        expect(violation).toMatchObject({ directive: 'other', source: 'other', blockedOrigin: null });
    });

    it('reads at most 20 reports from one request', () => {
        const many = Array.from({ length: 50 }, () => ({ type: 'csp-violation', body: { effectiveDirective: 'img-src', blockedURL: 'data:' } }));
        expect(parseCspReports(many)).toHaveLength(20);
    });
});

describe('POST /api/csp-report', () => {
    afterEach(() => metrics.cspViolations.reset());

    const report = (body: string) => POST(new Request('http://localhost/api/csp-report', { method: 'POST', body }));

    it('counts each violation by directive and kind of source', async () => {
        const res = await report(JSON.stringify({ 'csp-report': { 'violated-directive': 'img-src', 'blocked-uri': 'https://tracker.example/p.gif', 'document-uri': 'https://splitx.example/' } }));

        expect(res.status).toBe(204);
        const values = (await metrics.cspViolations.get()).values;
        expect(values).toEqual([expect.objectContaining({ labels: { directive: 'img-src', source: 'external' }, value: 1 })]);
    });

    it('refuses bodies that are not JSON or are over 16 KB', async () => {
        expect((await report('not json')).status).toBe(400);
        expect((await report('x'.repeat(17 * 1024))).status).toBe(413);
    });
});
