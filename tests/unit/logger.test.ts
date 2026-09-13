import { AlwaysOnSampler, NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { trace } from '@opentelemetry/api';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { logger } from '@/lib/logger';

function capture() {
    const out: string[] = [];
    const err: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
        out.push(String(chunk));
        return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
        err.push(String(chunk));
        return true;
    });
    return { out, err, parse: (line: string) => JSON.parse(line) };
}

beforeAll(() => {
    // Same setup as instrumentation: a real context manager, so "active span" means something.
    new NodeTracerProvider({ sampler: new AlwaysOnSampler() }).register();
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
});

describe('logger', () => {
    it('writes one JSON object per line with service metadata', () => {
        const { out, parse } = capture();
        logger.info('request', { route: '/api/me', status: 401 });

        expect(out).toHaveLength(1);
        expect(out[0].endsWith('\n')).toBe(true);
        expect(parse(out[0])).toMatchObject({ level: 'info', msg: 'request', service: 'splitx', route: '/api/me', status: 401 });
        expect(parse(out[0]).ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('sends warnings and errors to stderr and everything else to stdout', () => {
        const { out, err } = capture();
        logger.info('a');
        logger.warn('b');
        logger.error('c');

        expect(out).toHaveLength(1);
        expect(err).toHaveLength(2);
    });

    it('stamps lines with the ID of the trace that is active when they are written', () => {
        const { out, parse } = capture();
        const tracer = trace.getTracer('test');

        let traceId = '';
        tracer.startActiveSpan('handler', (span) => {
            traceId = span.spanContext().traceId;
            logger.info('inside a request');
            span.end();
        });
        logger.info('outside any request');

        expect(parse(out[0]).requestId).toBe(traceId);
        expect(parse(out[1]).requestId).toBeUndefined();
    });

    it('serialises errors with name, message, code and stack', () => {
        const { err, parse } = capture();
        const failure = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
        logger.error('Create transaction failed', { err: failure });

        const entry = parse(err[0]);
        expect(entry.err).toMatchObject({ name: 'Error', message: 'Unique constraint failed', code: 'P2002' });
        expect(entry.err.stack).toContain('Unique constraint failed');
    });

    it('respects LOG_LEVEL', () => {
        vi.stubEnv('LOG_LEVEL', 'warn');
        const { out, err } = capture();
        logger.debug('hidden');
        logger.info('hidden');
        logger.warn('shown');

        expect(out).toHaveLength(0);
        expect(err).toHaveLength(1);
    });

    it('still writes a line when a field cannot be serialised', () => {
        const { out, parse } = capture();
        const circular: Record<string, unknown> = {};
        circular.self = circular;
        logger.info('odd payload', { circular });

        expect(parse(out[0])).toMatchObject({ msg: 'odd payload', note: 'fields were not serialisable' });
    });
});
