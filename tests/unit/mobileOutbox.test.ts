import { describe, expect, it } from 'vitest';
import { createApi, type StoredSession } from '../../apps/mobile/src/api/client';
import { ME, seedLedger, type Expense, type Ledger } from '../../apps/mobile/src/data/ledger';
import { deleting, reviveChanges, send, withChanges, type Change } from '../../apps/mobile/src/data/outbox';
import type { SyncGroup } from '@/lib/contract/v1';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const far = new Date(Date.now() + 15 * 60_000).toISOString();

/** An API signed in, whose every request after the refresh goes to `handler`. */
function apiWith(handler: (path: string, init: RequestInit) => Response | Promise<Response>) {
    let session: StoredSession | null = { refreshToken: 'r'.repeat(40), deviceId: 'device-1' };
    const calls: string[] = [];
    const api = createApi({
        baseUrl: 'https://splitit.test',
        store: { load: async () => session, save: async (next) => void (session = next), clear: async () => void (session = null) },
        device: () => ({ platform: 'android', name: 'Test', appVersion: '0.1.0' }),
        fetch: (async (url: string, init: RequestInit) => {
            const path = url.replace('https://splitit.test', '');
            if (path === '/api/v1/auth/refresh') return json(200, { tokens: { accessToken: 'a'.repeat(40), accessExpiresAt: far, refreshToken: 'n'.repeat(40), refreshExpiresAt: far, deviceId: 'device-1' } });
            calls.push(`${init.method ?? 'GET'} ${path}`);
            return handler(path, init);
        }) as typeof fetch,
    });
    return { api, calls };
}

const lunch: Expense = { id: 'client-0000000000000001', groupId: 'g1', title: 'Lunch', category: 'food', amount: 600, payerId: ME, splitType: 'equal', splits: [{ userId: ME, amount: 300 }, { userId: 'u2', amount: 300 }], createdAt: new Date('2026-11-14T10:00:00Z') };
const addLunch: Change = { kind: 'expense', id: lunch.id, local: lunch, body: { clientId: lunch.id, groupId: 'g1', title: 'Lunch', amount: 600, category: 'food', payerId: 'u1', splitType: 'equal', splitAmong: ['u1', 'u2'] } };
const group: SyncGroup = { id: 'g1', version: 'v1', name: 'Goa', emoji: '🏖️', ownerId: 'u1', people: [], expenses: [], settlements: [] };

describe('what the screens show while changes wait', () => {
    it('adds waiting expenses marked as sending, and hides ones waiting to be deleted', () => {
        const ledger: Ledger = seedLedger();
        const shown = withChanges(ledger, [addLunch, { kind: 'delete_expense', id: 'delete-e1', expenseId: 'e1', groupId: 'goa' }]);
        expect(shown.expenses.find((e) => e.id === lunch.id)?.pending).toBe(true);
        expect(shown.expenses.find((e) => e.id === 'e1')).toBeUndefined();
        expect(withChanges(ledger, [])).toBe(ledger);
    });

    it('forgets an expense deleted before it was ever sent, instead of sending both', () => {
        expect(deleting([addLunch], lunch.id, 'g1')).toEqual([]);
        expect(deleting([], 'e1', 'goa')).toEqual([{ kind: 'delete_expense', id: 'delete-e1', expenseId: 'e1', groupId: 'goa' }]);
    });

    it('come back from the phone’s storage with their dates, and junk is dropped', () => {
        const back = reviveChanges(JSON.stringify([addLunch, { nonsense: true }]));
        expect(back).toHaveLength(1);
        expect(back[0].kind === 'expense' && back[0].local.createdAt).toEqual(lunch.createdAt);
        expect(reviveChanges('not json')).toEqual([]);
    });
});

describe('sending one change', () => {
    it('saves an expense and puts the server’s copy in the group at once', async () => {
        const { api, calls } = apiWith(() => json(201, { expense: { id: 'srv-1', groupId: 'g1', title: 'Lunch', amount: 600, category: 'food', payerId: 'u1', splitType: 'equal', splits: [{ userId: 'u1', amount: 300 }, { userId: 'u2', amount: 300 }], createdAt: '2026-11-14T10:00:01.000Z' }, replayed: false }));
        const sent = await send(api, addLunch);
        expect(calls).toEqual(['POST /api/v1/expenses']);
        expect(sent.outcome).toBe('saved');
        if (sent.outcome === 'saved') expect(sent.patch([group])[0].expenses.map((e) => e.id)).toEqual(['srv-1']);
    });

    it('waits when offline or the server is in trouble, and is dropped with the reason when refused', async () => {
        const offline = apiWith(() => {
            throw new TypeError('Network request failed');
        });
        expect((await send(offline.api, addLunch)).outcome).toBe('wait');
        const trouble = apiWith(() => json(503, { error: 'Down', code: 'server_error' }));
        expect((await send(trouble.api, addLunch)).outcome).toBe('wait');
        const refused = apiWith(() => json(403, { error: 'You aren’t in that group any more.', code: 'not_member' }));
        expect(await send(refused.api, addLunch)).toEqual({ outcome: 'refused', why: 'You aren’t in that group any more.' });
    });

    it('counts deleting something already gone as done', async () => {
        const { api } = apiWith(() => json(404, { error: 'That expense isn’t here.', code: 'not_found' }));
        const sent = await send(api, { kind: 'delete_expense', id: 'delete-x', expenseId: 'x', groupId: 'g1' });
        expect(sent.outcome).toBe('saved');
    });

    it('marks a payment paid after asking for it, and a retry reuses the same open one', async () => {
        const settlement = { id: 's1', groupId: 'g1', fromId: 'u1', toId: 'u2', amount: 300, status: 'pending', method: 'cash', note: null, createdAt: '2026-11-14T10:00:00.000Z' };
        const { api, calls } = apiWith((path) => (path === '/api/v1/settlements' ? json(200, { settlement, reused: true }) : json(200, { settlement: { ...settlement, status: 'paid_pending' }, upiUrl: null })));
        const sent = await send(api, { kind: 'payment', id: 'p1', cash: true, local: { id: 'p1', groupId: 'g1', fromId: ME, toId: 'u2', amount: 300, method: 'cash', status: 'paid_pending', createdAt: new Date() }, body: { groupId: 'g1', toUserId: 'u2', amount: 300, method: 'cash' } });
        expect(calls).toEqual(['POST /api/v1/settlements', 'POST /api/v1/settlements/s1']);
        if (sent.outcome === 'saved') expect(sent.patch([group])[0].settlements[0]).toMatchObject({ id: 's1', status: 'paid_pending' });
    });
});
