import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as metricsModule from '@/lib/metrics';

const { metrics, httpMethodLabel, recordProxyDecision, recordSettlementCompleted, recordTransactionCreated } = metricsModule;

async function valueOf(metric: { get(): Promise<{ values: { labels: object; value: number }[] }> }, labels: object) {
    const { values } = await metric.get();
    return values.find((v) => JSON.stringify(v.labels) === JSON.stringify(labels))?.value ?? 0;
}

describe('metrics registry', () => {
    it('is shared by separately loaded copies of the module (the phase-0 split-registry bug)', async () => {
        // Next.js compiles lib/metrics.ts into each server entry point. Simulate a
        // second bundle by discarding the module cache and importing it again.
        vi.resetModules();
        const secondCopy = await import('@/lib/metrics');

        expect(secondCopy).not.toBe(metricsModule);
        expect(secondCopy.register).toBe(metricsModule.register);

        const before = await valueOf(metrics.httpRequestsTotal, { method: 'GET', route: '/probe', status_code: '200' });
        secondCopy.metrics.httpRequestsTotal.inc({ method: 'GET', route: '/probe', status_code: '200' });
        expect(await valueOf(metrics.httpRequestsTotal, { method: 'GET', route: '/probe', status_code: '200' })).toBe(before + 1);
    });
});

describe('label normalisation', () => {
    beforeEach(() => {
        metrics.transactionsCreated.reset();
        metrics.transactionValue.reset();
        metrics.settlementsCompleted.reset();
        metrics.settlementValue.reset();
        metrics.httpRequestsTotal.reset();
        metrics.proxyDecisions.reset();
    });

    it('keeps known categories and folds user-defined ones into "custom"', async () => {
        recordTransactionCreated('manual', 'food', 25_000);
        recordTransactionCreated('manual', 'my-secret-hobby-category', 10_000);

        expect(await valueOf(metrics.transactionsCreated, { source: 'manual', category: 'food' })).toBe(1);
        expect(await valueOf(metrics.transactionsCreated, { source: 'manual', category: 'custom' })).toBe(1);
        expect(await valueOf(metrics.transactionValue, { source: 'manual' })).toBe(35_000);
    });

    it('never adds a non-positive or non-finite amount to a value counter', async () => {
        recordTransactionCreated('receipt', 'food', 0);
        recordTransactionCreated('receipt', 'food', Number.NaN);
        recordTransactionCreated('receipt', 'food', -500);

        expect(await valueOf(metrics.transactionsCreated, { source: 'receipt', category: 'food' })).toBe(3);
        expect(await valueOf(metrics.transactionValue, { source: 'receipt' })).toBe(0);
    });

    it('maps settlement methods to a bounded set', async () => {
        recordSettlementCompleted('upi', 1_000);
        recordSettlementCompleted('cash', 2_000);
        recordSettlementCompleted('crypto-wallet-9000', 3_000);
        recordSettlementCompleted(null, 4_000);

        expect(await valueOf(metrics.settlementsCompleted, { method: 'upi' })).toBe(1);
        expect(await valueOf(metrics.settlementsCompleted, { method: 'cash' })).toBe(1);
        expect(await valueOf(metrics.settlementsCompleted, { method: 'other' })).toBe(2);
        expect(await valueOf(metrics.settlementValue, { method: 'other' })).toBe(7_000);
    });

    it.each([
        ['get', 'GET'],
        ['POST', 'POST'],
        ['PROPFIND', 'OTHER'],
        [undefined, 'OTHER'],
        [42, 'OTHER'],
    ])('normalises HTTP method %j to %s', (input, expected) => {
        expect(httpMethodLabel(input)).toBe(expected);
    });
});

describe('recordProxyDecision', () => {
    beforeEach(() => {
        metrics.httpRequestsTotal.reset();
        metrics.proxyDecisions.reset();
    });

    it('does not count a pass-through as a response — the route span counts it', async () => {
        recordProxyDecision('pass', 'GET', 200);
        expect(await valueOf(metrics.proxyDecisions, { decision: 'pass' })).toBe(1);
        expect((await metrics.httpRequestsTotal.get()).values).toHaveLength(0);
    });

    it('counts responses the proxy answers itself, with their real status', async () => {
        recordProxyDecision('redirect_login', 'get', 307);
        recordProxyDecision('rate_limited', 'POST', 429);

        expect(await valueOf(metrics.httpRequestsTotal, { method: 'GET', route: '(proxy)', status_code: '307' })).toBe(1);
        expect(await valueOf(metrics.httpRequestsTotal, { method: 'POST', route: '(proxy)', status_code: '429' })).toBe(1);
    });
});
