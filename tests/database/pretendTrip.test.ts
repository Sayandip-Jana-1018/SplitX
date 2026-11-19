/**
 * The pretend trip (docs/mobile/ROADMAP.md, Phase 4's exit test): a phone adds 30 expenses with no
 * signal, deletes one and edits another, then comes back online on a bad connection that loses
 * some answers. Afterwards the phone (its own ledger, from sync), the server (the website's
 * ledger) and an independent sum must agree on every balance, to the paisa, with nothing saved
 * twice.
 *
 * Everything real but the network: the app's own API client, outbox and ledger code, the server's
 * own route handlers and a real Postgres. The "network" between them can be cut, or can lose an
 * answer after the server has acted on the request.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApi, type StoredSession } from '../../apps/mobile/src/api/client';
import { accountLedger } from '../../apps/mobile/src/data/account';
import { groupBalances, makeExpense, ME, type Expense, type Group } from '../../apps/mobile/src/data/ledger';
import { deleting, editBody, send, sharesBody, type Change } from '../../apps/mobile/src/data/outbox';
import { SyncAnswer } from '@/lib/contract/v1';
import { prisma } from '@/lib/db';
import { loadGroupLedger } from '@/lib/ledger';
import { startSession } from '@/lib/mobileAuth';
import { emptyDatabase, groupOf, person } from './fixtures';

const refreshRoute = await import('@/app/api/v1/auth/refresh/route');
const expensesRoute = await import('@/app/api/v1/expenses/route');
const expenseRoute = await import('@/app/api/v1/expenses/[id]/route');
const syncRoute = await import('@/app/api/v1/sync/route');

beforeAll(() => {
    process.env.MOBILE_TOKEN_SECRET = 'a-database-test-secret-of-32-characters-or-more';
});
beforeEach(emptyDatabase);
afterAll(() => prisma.$disconnect());

/** The network between phone and server: off, on, or on but losing the next few answers. */
function network() {
    const state = { offline: false, loseNextAnswers: 0, requests: 0 };
    const routes: [RegExp, Partial<Record<string, (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>>>][] = [
        [/^\/api\/v1\/auth\/refresh$/, { POST: (request) => refreshRoute.POST(request) }],
        [/^\/api\/v1\/expenses$/, { POST: (request) => expensesRoute.POST(request) }],
        [/^\/api\/v1\/expenses\/([^/]+)$/, { PATCH: (request, context) => expenseRoute.PATCH(request, context as never), DELETE: (request, context) => expenseRoute.DELETE(request, context as never) }],
        [/^\/api\/v1\/sync$/, { POST: (request) => syncRoute.POST(request) }],
    ];
    const fetch = (async (url: string, init: RequestInit = {}) => {
        if (state.offline) throw new TypeError('Network request failed');
        const path = new URL(url).pathname;
        const method = init.method ?? 'GET';
        for (const [pattern, handlers] of routes) {
            const match = pattern.exec(path);
            const handler = match && handlers[method];
            if (!handler) continue;
            state.requests += 1;
            const response = await handler(new Request(url, init), { params: Promise.resolve<Record<string, string>>(match[1] ? { id: match[1] } : {}) });
            // The server did it; the answer never reached the phone.
            if (state.loseNextAnswers > 0 && !path.endsWith('/refresh')) {
                state.loseNextAnswers -= 1;
                throw new TypeError('Network request failed');
            }
            return response;
        }
        throw new Error(`No route for ${method} ${path}`);
    }) as typeof globalThis.fetch;
    return { state, fetch };
}

/** The phone's flush: changes go in order; one that has to wait is tried again on the next pass. */
async function flush(api: ReturnType<typeof createApi>, queue: Change[], passes = 10) {
    let left = [...queue];
    for (let pass = 0; pass < passes && left.length > 0; pass++) {
        const still: Change[] = [];
        for (const [index, change] of left.entries()) {
            const sent = await send(api, change);
            if (sent.outcome === 'refused') throw new Error(`refused: ${sent.why}`);
            // Waiting keeps the order: this one and everything after it wait for the next pass.
            if (sent.outcome === 'wait') {
                still.push(...left.slice(index));
                break;
            }
        }
        left = still;
    }
    return left;
}

describe('the pretend trip', () => {
    it('adds 30 expenses offline, reconnects on a bad line, and the phone, the server and the sums agree to the paisa', async () => {
        const asha = await person('Asha');
        const ravi = await person('Ravi');
        const meera = await person('Meera');
        const kabir = await person('Kabir');
        const { group } = await groupOf(asha, [ravi, meera, kabir]);

        // The phone: Asha's, signed in, its API on the pretend network.
        const net = network();
        const session = await startSession(asha.id, { platform: 'android', name: 'Trip phone' });
        let stored: StoredSession | null = { refreshToken: session.refreshToken, deviceId: session.deviceId };
        const api = createApi({
            baseUrl: 'https://splitit.test',
            store: { load: async () => stored, save: async (next) => void (stored = next), clear: async () => void (stored = null) },
            device: () => ({ platform: 'android', name: 'Trip phone', appVersion: '0.1.0' }),
            fetch: net.fetch,
        });

        // The group as the phone knows it: Asha is ME there.
        const local: Group = { id: group.id, name: 'Goa', emoji: '🏖️', memberIds: [ME, ravi.id, meera.id, kabir.id] };
        const serverId = (id: string) => (id === ME ? asha.id : id);
        const toServer = (id: string) => (id === ME ? asha.id : id);

        // ── No signal: 30 expenses, every kind of split, any of the four paying.
        net.state.offline = true;
        const payers = [ME, ravi.id, meera.id, kabir.id];
        const made: Expense[] = [];
        let queue: Change[] = [];
        for (let n = 1; n <= 30; n++) {
            const amount = 10_000 + n * 1_337 + (n % 7); // paise, deliberately awkward
            const payerId = payers[n % 4];
            const kind = n % 3;
            const expense = makeExpense(
                kind === 0
                    ? { id: `trip-${String(n).padStart(4, '0')}-0000-4000-8000-000000000000`, groupId: group.id, title: `Thing ${n}`, category: 'food', amount, payerId, createdAt: new Date(2026, 10, 1, 9, n), among: n % 2 ? local.memberIds : [ME, ravi.id] }
                    : kind === 1
                      ? { id: `trip-${String(n).padStart(4, '0')}-0000-4000-8000-000000000000`, groupId: group.id, title: `Thing ${n}`, category: 'transport', amount, payerId, createdAt: new Date(2026, 10, 1, 9, n), splitType: 'custom', shares: [{ userId: ME, amount: amount - 3_001 }, { userId: meera.id, amount: 3_001 }] }
                      : { id: `trip-${String(n).padStart(4, '0')}-0000-4000-8000-000000000000`, groupId: group.id, title: `Thing ${n}`, category: 'stay', amount, payerId, createdAt: new Date(2026, 10, 1, 9, n), splitType: 'percentage', shares: [{ userId: ME, amount: Math.round(amount * 0.4) }, { userId: kabir.id, amount: amount - Math.round(amount * 0.4) }] },
                local,
                serverId,
            );
            made.push(expense);
            const among = expense.splitType === 'equal' ? expense.splits.map((split) => split.userId) : [];
            const change: Change = { kind: 'expense', id: expense.id, local: expense, body: { clientId: expense.id, groupId: group.id, payerId: serverId(payerId), ...sharesBody(expense, among, serverId) } };
            // Tried at once, as the phone does: no signal, so it waits.
            expect((await send(api, change)).outcome).toBe('wait');
            queue.push(change);
        }
        // Thing 7 was a mistake: deleted before it was ever sent, so it is simply never sent.
        queue = deleting(queue, made[6].id, group.id);
        expect(queue).toHaveLength(29);
        expect(await prisma.transaction.count()).toBe(0);

        // ── Back online, on a bad line: the first three answers are lost after the server acted.
        net.state.offline = false;
        net.state.loseNextAnswers = 3;
        expect(await flush(api, queue)).toEqual([]);
        expect(await prisma.transaction.count({ where: { deletedAt: null } })).toBe(29);

        // ── Online again: Thing 12 corrected (₹ and who shares it), as the phone sends edits.
        const answer = SyncAnswer.parse(await (await net.fetch('https://splitit.test/api/v1/sync', { method: 'POST', headers: { authorization: `Bearer ${(await refreshFor(stored!))}`, 'content-type': 'application/json' }, body: JSON.stringify({ known: {} }) })).json());
        const seen = accountLedger(answer.changed, asha.id);
        const before = seen.expenses.find((expense) => expense.title === 'Thing 12')!;
        const after: Expense = { ...makeExpense({ ...before, amount: 99_999, among: [ME, ravi.id, meera.id] }, local, serverId), id: before.id, updatedAt: before.updatedAt };
        const body = editBody(before, after, [ME, ravi.id, meera.id], serverId)!;
        expect(body.expectedUpdatedAt).toBe(before.updatedAt);
        net.state.loseNextAnswers = 1;
        expect(await flush(api, [{ kind: 'edit_expense', id: `edit-${before.id}`, expenseId: before.id, groupId: group.id, body, local: after }])).toEqual([]);

        // ── Everyone agrees.
        const synced = SyncAnswer.parse(await (await net.fetch('https://splitit.test/api/v1/sync', { method: 'POST', headers: { authorization: `Bearer ${(await refreshFor(stored!))}`, 'content-type': 'application/json' }, body: JSON.stringify({ known: {} }) })).json());
        const phone = groupBalances(accountLedger(synced.changed, asha.id), group.id);
        const server = (await loadGroupLedger(group.id))!.balances;

        // What the phone showed while offline is exactly what the server saved, share by share.
        const saved = await prisma.transaction.findMany({ where: { deletedAt: null }, select: { title: true, splits: { select: { userId: true, amount: true } } } });
        for (const expense of made.filter((e) => e.title !== 'Thing 7' && e.title !== 'Thing 12')) {
            const row = saved.find((candidate) => candidate.title === expense.title)!;
            expect(row.splits.map((split) => `${split.userId}:${split.amount}`).sort()).toEqual(expense.splits.map((split) => `${toServer(split.userId)}:${split.amount}`).sort());
        }

        // The independent sum: what each paid, less each one's share, over what should be saved.
        const kept = made.filter((expense) => expense.id !== made[6].id).map((expense) => (expense.title === 'Thing 12' ? after : expense));
        const expected: Record<string, number> = {};
        for (const expense of kept) {
            expected[toServer(expense.payerId)] = (expected[toServer(expense.payerId)] ?? 0) + expense.amount;
            for (const split of expense.splits) expected[toServer(split.userId)] = (expected[toServer(split.userId)] ?? 0) - split.amount;
        }

        for (const user of [asha, ravi, meera, kabir]) {
            const phoneSays = phone[user.id === asha.id ? ME : user.id] ?? 0;
            expect({ who: user.id, phone: phoneSays }).toEqual({ who: user.id, phone: expected[user.id] ?? 0 });
            expect({ who: user.id, server: server[user.id] ?? 0 }).toEqual({ who: user.id, server: expected[user.id] ?? 0 });
        }
        expect(Object.values(server).reduce((sum, amount) => sum + amount, 0)).toBe(0);
        // Nothing twice, Thing 7 never, Thing 12 as corrected.
        const rows = await prisma.transaction.findMany({ where: { deletedAt: null }, select: { title: true, amount: true } });
        expect(rows).toHaveLength(29);
        expect(new Set(rows.map((row) => row.title)).size).toBe(29);
        expect(rows.some((row) => row.title === 'Thing 7')).toBe(false);
        expect(rows.find((row) => row.title === 'Thing 12')?.amount).toBe(99_999);
        expect(net.state.requests).toBeGreaterThan(30);
    });
});

/** A fresh access token for a raw request in the test (the app's client refreshes its own). */
async function refreshFor(session: StoredSession) {
    const response = await refreshRoute.POST(new Request('https://splitit.test/api/v1/auth/refresh', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken: session.refreshToken }) }));
    const { tokens } = await response.json();
    session.refreshToken = tokens.refreshToken;
    return tokens.accessToken as string;
}
