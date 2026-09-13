import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/settlements/preview/route';
import { metrics } from '@/lib/metrics';
import { REQUEST_START_HEADER, requestStartValue } from '@/lib/requestQueue';

const URL = 'http://localhost/api/settlements/preview';

function preview(body: unknown, headers: Record<string, string> = {}) {
    return POST(new Request(URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: typeof body === 'string' ? body : JSON.stringify(body),
    }));
}

async function previews(mode: string, outcome: string) {
    const { values } = await metrics.settlementPreviews.get();
    return values.find((v) => v.labels.mode === mode && v.labels.outcome === outcome)?.value ?? 0;
}

describe('POST /api/settlements/preview', () => {
    beforeEach(() => {
        metrics.settlementPreviews.reset();
        vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    });
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllEnvs();
    });

    describe('balances', () => {
        it('returns the fewest transfers, with names, that clear every balance', async () => {
            const balances = [
                { id: 'asha', name: 'Asha', amount: -700 },
                { id: 'bala', name: 'Bala', amount: -300 },
                { id: 'chen', name: 'Chen', amount: 500 },
                { id: 'dev', name: 'Dev', amount: 300 },
                { id: 'esha', name: 'Esha', amount: 200 },
            ];
            const res = await preview({ balances });
            const { data } = await res.json();

            expect(res.status).toBe(200);
            expect(data.summary).toEqual({
                people: 5,
                unsettled: 5,
                totalOwed: 1_000,
                transfers: 3,
                greedyTransfers: 4,
                algorithm: 'exact',
                optimal: true,
            });
            expect(data.transfers).toContainEqual({ from: 'bala', fromName: 'Bala', to: 'dev', toName: 'Dev', amount: 300 });

            const left = new Map(balances.map((b) => [b.id, b.amount]));
            for (const t of data.transfers) {
                left.set(t.from, left.get(t.from)! + t.amount);
                left.set(t.to, left.get(t.to)! - t.amount);
            }
            expect([...left.values()].every((amount) => amount === 0)).toBe(true);
            expect(typeof data.computeMs).toBe('number');
            expect(await previews('balances', 'ok')).toBe(1);
        });

        it('names are optional', async () => {
            const res = await preview({ balances: [{ id: 'a', amount: 250 }, { id: 'b', amount: -250 }] });
            const { data } = await res.json();
            expect(data.transfers).toEqual([{ from: 'b', fromName: null, to: 'a', toName: null, amount: 250 }]);
        });

        it.each([
            [{ balances: [{ id: 'a', amount: 100 }, { id: 'b', amount: -99 }] }, 'Balances must sum to zero; these sum to 1 paise'],
            [{ balances: [{ id: 'a', amount: 100 }, { id: 'a', amount: -100 }] }, 'Each id can appear only once'],
            [{ balances: [{ id: 'a', amount: 10.5 }, { id: 'b', amount: -10.5 }] }, 'balances.0.amount'],
            [{ balances: [{ id: 'a', amount: '100' }, { id: 'b', amount: -100 }] }, 'balances.0.amount'],
            [{ balances: [] }, 'balances'],
            [{ balances: [{ id: '', amount: 0 }] }, 'balances.0.id'],
            [{ balances: [{ id: 'a', amount: 0, role: 'admin' }] }, 'balances.0'],
        ])('rejects %j', async (body, message) => {
            const res = await preview(body);
            expect(res.status).toBe(400);
            expect((await res.json()).error).toContain(message);
            expect(await previews('balances', 'invalid')).toBe(1);
        });

        it('rejects more than 2,000 balances', async () => {
            const balances = Array.from({ length: 2_002 }, (_, i) => ({ id: `${i}`, amount: i % 2 === 0 ? 1 : -1 }));
            const res = await preview({ balances });
            expect(res.status).toBe(400);
        });
    });

    describe('scenario', () => {
        it('plans a simulated trip, identically for the same seed', async () => {
            const first = await (await preview({ scenario: { members: 300, seed: 42 } })).json();
            const second = await (await preview({ scenario: { members: 300, seed: 42 } })).json();

            expect(first.data.scenario).toEqual({ members: 300, seed: 42, expenses: 900, totalSpent: expect.any(Number) });
            expect(first.data.summary).toEqual(second.data.summary);
            expect(first.data.transfers).toEqual(second.data.transfers);
            expect(first.data.summary.people).toBe(300);
            expect(first.data.summary.transfers).toBeLessThanOrEqual(first.data.summary.greedyTransfers);
            expect(first.data.summary.directTransfers).toBeGreaterThan(first.data.summary.transfers);
            expect(first.data.transfers).toHaveLength(20);
            expect(first.data.transfers[0].fromName).toEqual(expect.any(String));
            expect(await previews('scenario', 'ok')).toBe(2);
        });

        it('shows the largest transfers first', async () => {
            const { data } = await (await preview({ scenario: { members: 200, seed: 7 } })).json();
            const amounts = data.transfers.map((t: { amount: number }) => t.amount);
            expect(amounts).toEqual([...amounts].sort((a, b) => b - a));
        });

        it('picks a seed when none is given and returns it so the trip can be replayed', async () => {
            const { data } = await (await preview({ scenario: { members: 12 } })).json();
            expect(Number.isInteger(data.scenario.seed)).toBe(true);

            const replay = await (await preview({ scenario: { members: 12, seed: data.scenario.seed } })).json();
            expect(replay.data.summary).toEqual(data.summary);
        });

        it.each([
            [{ scenario: { members: 1 } }],
            [{ scenario: { members: 2_001 } }],
            [{ scenario: { members: 10.5 } }],
            [{ scenario: { members: 10, seed: -1 } }],
            [{ scenario: { members: 10, seed: 2 ** 32 } }],
            [{ scenario: {} }],
        ])('rejects %j', async (body) => {
            const res = await preview(body);
            expect(res.status).toBe(400);
            expect(await previews('scenario', 'invalid')).toBe(1);
        });
    });

    describe('requests', () => {
        it.each([
            ['not json', 'Request body is not valid JSON'],
            [[1, 2], 'Send balances or a scenario'],
            [{ something: 'else' }, 'Send balances or a scenario'],
            [{ balances: [], scenario: { members: 2 } }, 'Send either balances or a scenario, not both'],
        ])('rejects %j', async (body, message) => {
            const res = await preview(body);
            expect(res.status).toBe(400);
            expect((await res.json()).error).toBe(message);
        });

        it('refuses a body over 256 KB by its declared length, without reading it', async () => {
            const res = await preview({ balances: [] }, { 'content-length': String(300 * 1024) });
            expect(res.status).toBe(413);
            expect(await previews('unknown', 'too_large')).toBe(1);
        });

        it('stops reading an undeclared-length body once it passes 256 KB', async () => {
            let pulled = 0;
            const chunk = new TextEncoder().encode('x'.repeat(64 * 1024));
            const body = new ReadableStream<Uint8Array>({
                pull(controller) {
                    pulled += 1;
                    if (pulled > 20) controller.close();
                    else controller.enqueue(chunk);
                },
            });
            const res = await POST(new Request(URL, { method: 'POST', body, duplex: 'half' } as RequestInit));

            expect(res.status).toBe(413);
            expect(pulled).toBeLessThan(10);
        });
    });

    describe('load shedding', () => {
        const scenario = { scenario: { members: 50, seed: 1 } };

        it('refuses work that has already queued longer than PREVIEW_MAX_QUEUE_MS', async () => {
            vi.stubEnv('PREVIEW_MAX_QUEUE_MS', '500');
            const res = await preview(scenario, { [REQUEST_START_HEADER]: requestStartValue(Date.now() - 2_000) });

            expect(res.status).toBe(503);
            expect(res.headers.get('retry-after')).toBe('1');
            expect(await res.json()).toMatchObject({ success: false, code: 'OVERLOADED' });
            expect(await previews('scenario', 'shed')).toBe(1);
            expect(await previews('scenario', 'ok')).toBe(0);
        });

        it('serves requests that have not waited long, and records the wait', async () => {
            metrics.settlementPreviewQueue.reset();
            const res = await preview(scenario, { [REQUEST_START_HEADER]: requestStartValue(Date.now() - 20) });

            expect(res.status).toBe(200);
            const { values } = await metrics.settlementPreviewQueue.get();
            expect(values.find((v) => v.metricName === 'splitx_settlement_preview_queue_seconds_count')?.value).toBe(1);
        });

        it('serves requests the proxy did not stamp', async () => {
            expect((await preview(scenario)).status).toBe(200);
        });
    });
});
