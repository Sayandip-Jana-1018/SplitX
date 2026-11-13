import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ErrorBody, ExpenseSaved, GroupDetail } from '@/lib/contract/v1';
import { prisma } from '@/lib/db';
import { startSession } from '@/lib/mobileAuth';
import { emptyDatabase, groupOf, person } from './fixtures';

const expensesRoute = await import('@/app/api/v1/expenses/route');
const expenseRoute = await import('@/app/api/v1/expenses/[id]/route');
const groupRoute = await import('@/app/api/v1/groups/[groupId]/route');

beforeAll(() => {
    process.env.MOBILE_TOKEN_SECRET = 'a-database-test-secret-of-32-characters-or-more';
});
beforeEach(emptyDatabase);
afterAll(() => prisma.$disconnect());

async function bearerFor(user: { id: string }) {
    const { accessToken } = await startSession(user.id, { platform: 'android' });
    return { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' };
}

const save = async (headers: Record<string, string>, body: object) =>
    expensesRoute.POST(new Request('https://splitit.test/api/v1/expenses', { method: 'POST', headers, body: JSON.stringify(body) }));
const remove = (headers: Record<string, string>, id: string) =>
    expenseRoute.DELETE(new Request(`https://splitit.test/api/v1/expenses/${id}`, { method: 'DELETE', headers }), { params: Promise.resolve({ id }) });
const balances = async (headers: Record<string, string>, groupId: string) => {
    const detail = GroupDetail.parse(await (await groupRoute.GET(new Request(`https://splitit.test/api/v1/groups/${groupId}`, { headers }), { params: Promise.resolve({ groupId }) })).json());
    return Object.fromEntries(detail.people.map((p) => [p.name, p.balance]));
};

async function threeFriends() {
    const alice = await person('Alice');
    const bob = await person('Bob');
    const carol = await person('Carol');
    const { group } = await groupOf(alice, [bob, carol]);
    return { alice, bob, carol, group };
}

describe('saving an expense from the phone', () => {
    it('saves once however many times the phone retries, and moves balances as the website would', async () => {
        const { alice, group } = await threeFriends();
        const headers = await bearerFor(alice);
        const body = { clientId: randomUUID(), groupId: group.id, title: 'Dinner', amount: 900, category: 'food' };

        const first = await save(headers, body);
        expect(first.status).toBe(201);
        const saved = ExpenseSaved.parse(await first.json());
        expect(saved).toMatchObject({ replayed: false, expense: { title: 'Dinner', amount: 900, payerId: alice.id, category: 'food' } });
        expect(saved.expense.splits.reduce((sum, split) => sum + split.amount, 0)).toBe(900);

        const again = await save(headers, body);
        expect(again.status).toBe(200);
        expect(ExpenseSaved.parse(await again.json())).toMatchObject({ replayed: true, expense: { id: saved.expense.id } });
        expect(await prisma.transaction.count()).toBe(1);

        expect(await balances(headers, group.id)).toEqual({ Alice: 600, Bob: -300, Carol: -300 });
    });

    it('splits among the people chosen, and by exact amounts', async () => {
        const { alice, bob, carol, group } = await threeFriends();
        const headers = await bearerFor(alice);
        await save(headers, { clientId: randomUUID(), groupId: group.id, title: 'Cab', amount: 500, splitAmong: [alice.id, bob.id] });
        await save(headers, { clientId: randomUUID(), groupId: group.id, title: 'Tickets', amount: 300, payerId: carol.id, splitType: 'custom', splits: [{ userId: alice.id, amount: 100 }, { userId: carol.id, amount: 200 }] });
        expect(await balances(headers, group.id)).toEqual({ Alice: 250 - 100, Bob: -250, Carol: 300 - 200 });
    });

    it('refuses a split that doesn’t add up, a payer from outside, and a group you aren’t in', async () => {
        const { alice, bob, group } = await threeFriends();
        const outsider = await person('Mallory');
        const headers = await bearerFor(alice);

        const short = await save(headers, { clientId: randomUUID(), groupId: group.id, title: 'X', amount: 300, splitType: 'custom', splits: [{ userId: alice.id, amount: 100 }, { userId: bob.id, amount: 100 }] });
        expect(short.status).toBe(400);
        expect(ErrorBody.parse(await short.json()).code).toBe('bad_split');

        const strangerPaid = await save(headers, { clientId: randomUUID(), groupId: group.id, title: 'X', amount: 300, payerId: outsider.id });
        expect(ErrorBody.parse(await strangerPaid.json()).code).toBe('bad_payer');

        const notMine = await save(await bearerFor(outsider), { clientId: randomUUID(), groupId: group.id, title: 'X', amount: 300 });
        expect(notMine.status).toBe(404);
        expect(await prisma.transaction.count()).toBe(0);
    });

    it('needs a well-formed clientId and a signed-in phone', async () => {
        const { alice, group } = await threeFriends();
        expect((await save(await bearerFor(alice), { clientId: 'short', groupId: group.id, title: 'X', amount: 300 })).status).toBe(400);
        expect((await save({ 'content-type': 'application/json' }, { clientId: randomUUID(), groupId: group.id, title: 'X', amount: 300 })).status).toBe(401);
    });
});

describe('deleting an expense from the phone', () => {
    it('lets the payer delete it, puts balances back, and answers 404 the second time', async () => {
        const { alice, group } = await threeFriends();
        const headers = await bearerFor(alice);
        const { expense } = ExpenseSaved.parse(await (await save(headers, { clientId: randomUUID(), groupId: group.id, title: 'Dinner', amount: 900 })).json());

        expect((await remove(headers, expense.id)).status).toBe(204);
        expect(await balances(headers, group.id)).toEqual({ Alice: 0, Bob: 0, Carol: 0 });
        expect((await remove(headers, expense.id)).status).toBe(404);
        // A soft delete: the history keeps it.
        expect(await prisma.transaction.count()).toBe(1);
    });

    it('doesn’t let another member delete what they didn’t pay', async () => {
        const { alice, bob, group } = await threeFriends();
        const { expense } = ExpenseSaved.parse(await (await save(await bearerFor(alice), { clientId: randomUUID(), groupId: group.id, title: 'Dinner', amount: 900 })).json());
        expect((await remove(await bearerFor(bob), expense.id)).status).toBe(404);
        expect(await prisma.transaction.count({ where: { deletedAt: null } })).toBe(1);
    });
});
