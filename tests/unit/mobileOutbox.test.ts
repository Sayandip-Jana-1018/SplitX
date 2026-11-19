import { describe, expect, it } from 'vitest';
import { createApi, type StoredSession } from '../../apps/mobile/src/api/client';
import { ME, seedLedger, type Expense, type Ledger } from '../../apps/mobile/src/data/ledger';
import { deleting, editBody, editing, groupOf, reviveChanges, send, withChanges, type Change } from '../../apps/mobile/src/data/outbox';
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

    it('knows which group each change belongs to, to name it if refused', () => {
        expect(groupOf(addLunch)).toBe('g1');
        expect(groupOf({ kind: 'delete_expense', id: 'd', expenseId: 'e1', groupId: 'goa' })).toBe('goa');
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

    it('records cash handed to you: the payment from them, then accepting it, each step once', async () => {
        const settlement = { id: 's2', groupId: 'g1', fromId: 'u2', toId: 'u1', amount: 500, status: 'pending', method: 'cash', note: null, createdAt: '2026-11-14T10:00:00.000Z' };
        const bodies: unknown[] = [];
        const { api, calls } = apiWith((path, init) => {
            bodies.push(JSON.parse(String(init.body)));
            return path === '/api/v1/settlements' ? json(201, { settlement, reused: false }) : json(200, { settlement: { ...settlement, status: 'completed' }, upiUrl: null });
        });
        const change: Change = { kind: 'payment', id: 'p2', cash: true, received: true, local: { id: 'p2', groupId: 'g1', fromId: 'u2', toId: ME, amount: 500, method: 'cash', status: 'completed', createdAt: new Date() }, body: { groupId: 'g1', toUserId: 'u1', fromUserId: 'u2', amount: 500, method: 'cash' } };
        const sent = await send(api, change);
        expect(calls).toEqual(['POST /api/v1/settlements', 'POST /api/v1/settlements/s2']);
        expect(bodies[1]).toEqual({ action: 'accept_cash' });
        if (sent.outcome === 'saved') expect(sent.patch([group])[0].settlements[0]).toMatchObject({ id: 's2', status: 'completed' });

        // Sent again after the first try got through: already completed, so nothing more is asked.
        const again = apiWith(() => json(200, { settlement: { ...settlement, status: 'completed' }, reused: true }));
        await send(again.api, change);
        expect(again.calls).toEqual(['POST /api/v1/settlements']);
    });

    it('sends your answer to a payment, and shows it at once while it waits', async () => {
        const paid = { id: 's3', groupId: 'g1', fromId: 'u2', toId: ME, amount: 400, method: 'upi', status: 'paid_pending', createdAt: new Date() };
        const ledger: Ledger = { ...seedLedger(), settlements: [paid] };
        const sendBack: Change = { kind: 'move', id: 'move-s3', settlementId: 's3', groupId: 'g1', action: 'send_back' };
        expect(withChanges(ledger, [sendBack]).settlements[0]).toMatchObject({ id: 's3', status: 'initiated', pending: true });
        expect(withChanges(ledger, [sendBack, { ...sendBack, id: 'move-s3-2', action: 'approve' }]).settlements[0].status).toBe('completed');
        expect(reviveChanges(JSON.stringify([sendBack, { ...sendBack, action: 'steal' }]))).toEqual([sendBack]);

        const server = { id: 's3', groupId: 'g1', fromId: 'u2', toId: 'u1', amount: 400, status: 'initiated', method: 'upi', note: null, createdAt: '2026-11-14T10:00:00.000Z' };
        const { api, calls } = apiWith(() => json(200, { settlement: server, upiUrl: null }));
        const withIt = { ...group, settlements: [{ ...server, status: 'paid_pending' }] };
        const sent = await send(api, sendBack);
        expect(calls).toEqual(['POST /api/v1/settlements/s3']);
        if (sent.outcome === 'saved') expect(sent.patch([withIt])[0].settlements).toEqual([expect.objectContaining({ id: 's3', status: 'initiated' })]);
    });
});

describe('editing an expense', () => {
    const saved: Expense = { ...lunch, id: 'srv-9', updatedAt: '2026-11-14T10:00:01.000Z' };
    const serverId = (id: string) => (id === ME ? 'u1' : id);

    it('sends only what changed, the split whole, and the version the phone saw; nothing when nothing did', () => {
        expect(editBody(saved, { ...saved, title: 'Lunch at Toit' }, ['u1', 'u2'], serverId)).toEqual({ title: 'Lunch at Toit', expectedUpdatedAt: saved.updatedAt });
        const bigger = { ...saved, amount: 800, splits: [{ userId: ME, amount: 400 }, { userId: 'u2', amount: 400 }] };
        expect(editBody(saved, bigger, [ME, 'u2'], serverId)).toEqual({ amount: 800, splitType: 'equal', splitAmong: ['u1', 'u2'], expectedUpdatedAt: saved.updatedAt });
        const exact = { ...saved, splitType: 'custom' as const, splits: [{ userId: ME, amount: 100 }, { userId: 'u2', amount: 500 }] };
        expect(editBody(saved, exact, [], serverId)).toMatchObject({ splitType: 'custom', splits: [{ userId: 'u1', amount: 100 }, { userId: 'u2', amount: 500 }] });
        expect(editBody(saved, { ...saved }, [ME, 'u2'], serverId)).toBeNull();
    });

    it('goes as one with an edit already waiting, keeping the version first seen; a delete drops it', () => {
        const first: Change = { kind: 'edit_expense', id: 'edit-srv-9', expenseId: 'srv-9', groupId: 'g1', body: { title: 'A', expectedUpdatedAt: saved.updatedAt }, local: { ...saved, title: 'A' } };
        const second: Change = { kind: 'edit_expense', id: 'edit-srv-9', expenseId: 'srv-9', groupId: 'g1', body: { category: 'travel', expectedUpdatedAt: 'later' }, local: { ...saved, title: 'A', category: 'travel' } };
        const both = editing(editing([], first), second);
        expect(both).toHaveLength(1);
        expect(both[0].kind === 'edit_expense' && both[0].body).toEqual({ title: 'A', category: 'travel', expectedUpdatedAt: saved.updatedAt });
        expect(deleting(both, 'srv-9', 'g1')).toEqual([{ kind: 'delete_expense', id: 'delete-srv-9', expenseId: 'srv-9', groupId: 'g1' }]);
    });

    it('shows the edit at once while it waits, and comes back from storage', () => {
        const ledger: Ledger = { ...seedLedger(), expenses: [saved] };
        const change: Change = { kind: 'edit_expense', id: 'edit-srv-9', expenseId: 'srv-9', groupId: 'g1', body: { title: 'Dinner' }, local: { ...saved, title: 'Dinner' } };
        expect(withChanges(ledger, [change]).expenses).toEqual([{ ...saved, title: 'Dinner', pending: true }]);
        const back = reviveChanges(JSON.stringify([change]));
        expect(back[0].kind === 'edit_expense' && back[0].local.createdAt).toEqual(saved.createdAt);
    });

    it('puts the server’s copy in the group, with its new version', async () => {
        const answer = { expense: { id: 'srv-9', groupId: 'g1', title: 'Dinner', amount: 600, category: 'food', payerId: 'u1', splitType: 'equal', splits: [{ userId: 'u1', amount: 300 }, { userId: 'u2', amount: 300 }], createdAt: '2026-11-14T10:00:00.000Z', updatedAt: '2026-11-14T11:00:00.000Z' } };
        const { api, calls } = apiWith(() => json(200, answer));
        const withIt = { ...group, expenses: [{ id: 'srv-9', title: 'Lunch', category: 'food', amount: 600, payerId: 'u1', splitType: 'equal', splits: answer.expense.splits, receiptUrl: 'https://x.test/r.jpg', createdAt: answer.expense.createdAt, updatedAt: '2026-11-14T10:00:01.000Z' }] };
        const sent = await send(api, { kind: 'edit_expense', id: 'edit-srv-9', expenseId: 'srv-9', groupId: 'g1', body: { title: 'Dinner' }, local: { ...saved, title: 'Dinner' } });
        expect(calls).toEqual(['PATCH /api/v1/expenses/srv-9']);
        if (sent.outcome === 'saved') expect(sent.patch([withIt])[0].expenses[0]).toMatchObject({ title: 'Dinner', updatedAt: '2026-11-14T11:00:00.000Z', receiptUrl: 'https://x.test/r.jpg' });

        const conflict = apiWith(() => json(409, { error: 'Someone changed this expense before your edit arrived. Open it again to see theirs.', code: 'conflict' }));
        expect((await send(conflict.api, { kind: 'edit_expense', id: 'e', expenseId: 'srv-9', groupId: 'g1', body: { title: 'x' }, local: saved })).outcome).toBe('refused');
    });
});
