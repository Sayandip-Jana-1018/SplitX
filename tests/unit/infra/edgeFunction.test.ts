import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The CloudFront function in terraform/edge, rendered the way Terraform's
 * templatefile() renders it, then run. What runs at the edge is this file.
 */
const TEMPLATE = readFileSync('terraform/edge/edge.js.tftpl', 'utf8');

type Response = { statusCode: number; headers: Record<string, { value: string }>; body: { data: string } };
type Request = { uri: string; method: string; headers: Record<string, unknown> };

function render(online: boolean): string {
    return TEMPLATE.replace('${online}', String(online));
}

function handlerFor(online: boolean): (event: { request: Request }) => Request | Response {
    return new Function(`${render(online)}\nreturn handler;`)();
}

const request = (uri: string): Request => ({ uri, method: 'GET', headers: {} });

describe('the edge function template', () => {
    it('has exactly one Terraform interpolation and no directives', () => {
        // Anything else in ${...} or %{...} would be read by templatefile().
        expect(TEMPLATE.match(/\$\{/g)).toEqual(['${']);
        expect(TEMPLATE).toContain('var ONLINE = ${online};');
        expect(TEMPLATE).not.toContain('%{');
    });

    it('stays under CloudFront Functions\' 10 KB code limit', () => {
        expect(Buffer.byteLength(render(false))).toBeLessThan(10 * 1024);
    });
});

describe('offline: the platform is down', () => {
    const handler = handlerFor(false);

    it.each(['/', '/login', '/api/health/live', '/generic-webhook-trigger/invoke', '/_next/static/chunks/app.js'])(
        'answers %s itself with 503 and the offline page',
        (uri) => {
            const response = handler({ request: request(uri) }) as Response;
            expect(response.statusCode).toBe(503);
            expect(response.headers['content-type'].value).toBe('text/html; charset=utf-8');
            expect(response.headers['cache-control'].value).toBe('no-store');
            expect(response.body.data).toContain('The SplitX demo platform is offline');
            expect(response.body.data).toContain('href="https://splitsj.vercel.app"');
        },
    );
});

describe('online: the platform is up', () => {
    const handler = handlerFor(true);

    it.each([
        '/api/metrics',
        '/api/metrics/',
        '/API/Metrics',
        '/api//metrics',
        '//api/metrics',
        '/api/%6Detrics',
        '/api/metrics%2F',
        '/api/health/ready',
        '/api/health/ready/',
        '/api/Health/READY',
    ])('refuses %s with 403', (uri) => {
        const response = handler({ request: request(uri) }) as Response;
        expect(response.statusCode).toBe(403);
        expect(response.headers['cache-control'].value).toBe('no-store');
    });

    it.each([
        '/',
        '/api/health/live',
        '/api/health',
        '/api/metricsx',
        '/api/metrics/extra',
        '/api/settlements/preview',
        '/generic-webhook-trigger/invoke',
        '/_next/static/chunks/app.js',
        '/api/%E0%A4%A',
    ])('passes %s on unchanged', (uri) => {
        const original = request(uri);
        expect(handler({ request: original })).toBe(original);
        expect(original.uri).toBe(uri);
    });
});
