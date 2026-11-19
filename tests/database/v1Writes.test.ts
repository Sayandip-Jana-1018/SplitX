import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ErrorBody, ExpenseEdited, ExpenseSaved, GroupDetail } from '@/lib/contract/v1';
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
const change = (headers: Record<string, string>, id: string, body: object) =>
    expenseRoute.PATCH(new Request(`https://splitit.test/api/v1/expenses/${id}`, { method: 'PATCH', headers, body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });
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

describe('editing an expense from the phone', () => {
    it('changes only what is sent, recomputes the shares, and moves balances', async () => {
        const { alice, group } = await threeFriends();
        const headers = await bearerFor(alice);
        const { expense } = ExpenseSaved.parse(await (await save(headers, { clientId: randomUUID(), groupId: group.id, title: 'Dinner', amount: 900, category: 'food' })).json());
        expect(expense.updatedAt).toBeDefined();

        const answer = await change(headers, expense.id, { title: 'Dinner at Thalassa', amount: 1200, expectedUpdatedAt: expense.updatedAt });
        expect(answer.status).toBe(200);
        const { expense: edited } = ExpenseEdited.parse(await answer.json());
        expect(edited).toMatchObject({ id: expense.id, title: 'Dinner at Thalassa', amount: 1200, category: 'food', groupId: group.id });
        expect(edited.splits.reduce((sum, split) => sum + split.amount, 0)).toBe(1200);
        expect(edited.updatedAt).not.toBe(expense.updatedAt);
        expect(await balances(headers, group.id)).toEqual({ Alice: 800, Bob: -400, Carol: -400 });
    });

    it('splits again among the people chosen', async () => {
        const { alice, bob, group } = await threeFriends();
        const headers = await bearerFor(alice);
        const { expense } = ExpenseSaved.parse(await (await save(headers, { clientId: randomUUID(), groupId: group.id, title: 'Cab', amount: 900 })).json());
        const { expense: edited } = ExpenseEdited.parse(await (await change(headers, expense.id, { splitAmong: [alice.id, bob.id] })).json());
        expect(edited.splits.map((split) => split.amount).sort()).toEqual([450, 450]);
        expect(await balances(headers, group.id)).toEqual({ Alice: 450, Bob: -450, Carol: 0 });
    });

    it('refuses an edit made to an older copy, so nobody’s change is lost', async () => {
        const { alice, group } = await threeFriends();
        const headers = await bearerFor(alice);
        const { expense } = ExpenseSaved.parse(await (await save(headers, { clientId: randomUUID(), groupId: group.id, title: 'Dinner', amount: 900 })).json());
        expect((await change(headers, expense.id, { title: 'First edit', expectedUpdatedAt: expense.updatedAt })).status).toBe(200);

        const late = await change(headers, expense.id, { title: 'Made offline, before the first', expectedUpdatedAt: expense.updatedAt });
        expect(late.status).toBe(409);
        expect(ErrorBody.parse(await late.json()).code).toBe('conflict');
        expect((await prisma.transaction.findUniqueOrThrow({ where: { id: expense.id } })).title).toBe('First edit');
    });

    it('takes a retried edit whose first answer was lost as done, but still refuses a different one', async () => {
        const { alice, group } = await threeFriends();
        const headers = await bearerFor(alice);
        const { expense } = ExpenseSaved.parse(await (await save(headers, { clientId: randomUUID(), groupId: group.id, title: 'Cab', amount: 900 })).json());
        const edit = { title: 'Cab to the airport', amount: 1200, expectedUpdatedAt: expense.updatedAt };
        expect((await change(headers, expense.id, edit)).status).toBe(200);

        // The phone never heard back, so it sends the same edit again: already so, so done.
        const again = await change(headers, expense.id, edit);
        expect(again.status).toBe(200);
        expect(ExpenseEdited.parse(await again.json()).expense).toMatchObject({ title: 'Cab to the airport', amount: 1200 });
        expect(await prisma.auditLog.count({ where: { entityId: expense.id, action: 'update' } })).toBe(1);

        const different = await change(headers, expense.id, { ...edit, amount: 1300 });
        expect(ErrorBody.parse(await different.json()).code).toBe('conflict');
    });

    it('lets only the payer or the group’s owner edit, and refuses an edit that changes nothing', async () => {
        const { alice, bob, carol, group } = await threeFriends();
        const { expense } = ExpenseSaved.parse(await (await save(await bearerFor(bob), { clientId: randomUUID(), groupId: group.id, title: 'Snacks', amount: 300 })).json());
        expect((await change(await bearerFor(carol), expense.id, { title: 'Mine now' })).status).toBe(404);
        // Alice owns the group.
        expect((await change(await bearerFor(alice), expense.id, { title: 'Snacks and tea' })).status).toBe(200);
        const same = await change(await bearerFor(bob), expense.id, { title: 'Snacks and tea' });
        expect(same.status).toBe(400);
        expect(ErrorBody.parse(await same.json()).code).toBe('nothing_to_change');
    });

    it('needs the new shares to change a custom split, and a signed-in phone', async () => {
        const { alice, bob, carol, group } = await threeFriends();
        const headers = await bearerFor(alice);
        const { expense } = ExpenseSaved.parse(await (await save(headers, { clientId: randomUUID(), groupId: group.id, title: 'Stay', amount: 900, splitType: 'custom', splits: [{ userId: alice.id, amount: 500 }, { userId: bob.id, amount: 200 }, { userId: carol.id, amount: 200 }] })).json());
        expect((await change(headers, expense.id, { amount: 1000 })).status).toBe(400);
        const fixed = await change(headers, expense.id, { amount: 1000, splits: [{ userId: alice.id, amount: 600 }, { userId: bob.id, amount: 200 }, { userId: carol.id, amount: 200 }] });
        expect(fixed.status).toBe(200);
        expect((await change({ 'content-type': 'application/json' }, expense.id, { title: 'x' })).status).toBe(401);
    });
});
