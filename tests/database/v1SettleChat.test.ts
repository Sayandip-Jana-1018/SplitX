import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ErrorBody, GroupDetail, MessagePage, MessageSent, SettlementMoved, SettlementSaved } from '@/lib/contract/v1';
import { prisma } from '@/lib/db';
import { startSession } from '@/lib/mobileAuth';
import { emptyDatabase, groupOf, person } from './fixtures';

const expensesRoute = await import('@/app/api/v1/expenses/route');
const settlementsRoute = await import('@/app/api/v1/settlements/route');
const settlementRoute = await import('@/app/api/v1/settlements/[id]/route');
const groupRoute = await import('@/app/api/v1/groups/[groupId]/route');
const messagesRoute = await import('@/app/api/v1/groups/[groupId]/messages/route');

beforeAll(() => {
    process.env.MOBILE_TOKEN_SECRET = 'a-database-test-secret-of-32-characters-or-more';
});
beforeEach(emptyDatabase);
afterAll(() => prisma.$disconnect());

type Who = { id: string };
async function headersFor(user: Who) {
    const { accessToken } = await startSession(user.id, { platform: 'android' });
    return { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' };
}
const post = (path: string, headers: Record<string, string>, body: object) => new Request(`https://splitit.test${path}`, { method: 'POST', headers, body: JSON.stringify(body) });

const ask = async (user: Who, body: object) => settlementsRoute.POST(post('/api/v1/settlements', await headersFor(user), body));
const step = async (user: Who, id: string, body: object) => settlementRoute.POST(post(`/api/v1/settlements/${id}`, await headersFor(user), body), { params: Promise.resolve({ id }) });
async function balances(user: Who, groupId: string) {
    const answer = await groupRoute.GET(new Request(`https://splitit.test/api/v1/groups/${groupId}`, { headers: await headersFor(user) }), { params: Promise.resolve({ groupId }) });
    return Object.fromEntries(GroupDetail.parse(await answer.json()).people.map((p) => [p.name, p.balance]));
}

/** Alice paid 900 for the three of them: Bob and Carol owe her 300 each. */
async function dinnerOwed() {
    const alice = await person('Alice');
    const bob = await person('Bob');
    const carol = await person('Carol');
    const { group } = await groupOf(alice, [bob, carol]);
    await expensesRoute.POST(post('/api/v1/expenses', await headersFor(alice), { clientId: randomUUID(), groupId: group.id, title: 'Dinner', amount: 900 }));
    return { alice, bob, carol, group };
}

describe('asking for a payment', () => {
    it('makes one request however often it is asked, and refuses more than is owed', async () => {
        const { alice, bob, group } = await dinnerOwed();
        const first = await ask(bob, { groupId: group.id, toUserId: alice.id, amount: 300 });
        expect(first.status).toBe(201);
        const { settlement } = SettlementSaved.parse(await first.json());
        expect(settlement).toMatchObject({ status: 'pending', fromId: bob.id, toId: alice.id, amount: 300, groupId: group.id });

        const again = SettlementSaved.parse(await (await ask(bob, { groupId: group.id, toUserId: alice.id, amount: 300 })).json());
        expect(again).toMatchObject({ reused: true, settlement: { id: settlement.id } });

        const tooMuch = await ask(bob, { groupId: group.id, toUserId: alice.id, amount: 400 });
        expect(tooMuch.status).toBe(400);
        expect(ErrorBody.parse(await tooMuch.json()).code).toBe('too_much');
    });

    it('refuses settling with yourself, and a group you aren’t in', async () => {
        const { alice, bob, group } = await dinnerOwed();
        const self = await ask(bob, { groupId: group.id, toUserId: bob.id, amount: 100 });
        expect(self.status).toBe(400);
        const outsider = await person('Mallory');
        expect((await ask(outsider, { groupId: group.id, toUserId: alice.id, amount: 100 })).status).toBe(404);
    });
});

describe('a payment, step by step', () => {
    it('goes payer opens UPI, payer marks paid, receiver approves: balances clear and the chat says so', async () => {
        const { alice, bob, group } = await dinnerOwed();
        await prisma.user.update({ where: { id: alice.id }, data: { upiId: 'alice@okbank' } });
        const { settlement } = SettlementSaved.parse(await (await ask(bob, { groupId: group.id, toUserId: alice.id, amount: 300 })).json());

        const opened = SettlementMoved.parse(await (await step(bob, settlement.id, { action: 'open_upi' })).json());
        expect(opened.upiUrl).toMatch(/^upi:\/\/pay\?/);
        expect(opened.upiUrl).toContain('alice%40okbank');
        expect(opened.settlement.status).toBe('initiated');

        const paid = SettlementMoved.parse(await (await step(bob, settlement.id, { action: 'mark_paid', utrNumber: '123456789012' })).json());
        expect(paid.settlement.status).toBe('paid_pending');

        // The payer can't approve their own payment.
        const ownApproval = await step(bob, settlement.id, { action: 'approve' });
        expect(ownApproval.ok).toBe(false);
        expect(await balances(alice, group.id)).toEqual({ Alice: 600, Bob: -300, Carol: -300 });

        const approved = SettlementMoved.parse(await (await step(alice, settlement.id, { action: 'approve' })).json());
        expect(approved.settlement.status).toBe('completed');
        expect(await balances(alice, group.id)).toEqual({ Alice: 300, Bob: 0, Carol: -300 });
        expect(await prisma.groupMessage.count({ where: { groupId: group.id, type: 'system', settlementId: settlement.id } })).toBe(1);
    });

    it('lets the receiver record cash, and a declined payment moves nothing', async () => {
        const { alice, bob, carol, group } = await dinnerOwed();
        const cash = SettlementSaved.parse(await (await ask(alice, { groupId: group.id, toUserId: alice.id, fromUserId: carol.id, amount: 300, method: 'cash' })).json());
        expect(SettlementMoved.parse(await (await step(alice, cash.settlement.id, { action: 'accept_cash' })).json()).settlement.status).toBe('completed');

        const asked = SettlementSaved.parse(await (await ask(bob, { groupId: group.id, toUserId: alice.id, amount: 300 })).json());
        expect(SettlementMoved.parse(await (await step(alice, asked.settlement.id, { action: 'decline' })).json()).settlement.status).toBe('cancelled');
        expect(await balances(alice, group.id)).toEqual({ Alice: 300, Bob: -300, Carol: 0 });
    });

    it('answers 404 for a settlement in a group you aren’t in', async () => {
        const { alice, bob, group } = await dinnerOwed();
        const { settlement } = SettlementSaved.parse(await (await ask(bob, { groupId: group.id, toUserId: alice.id, amount: 300 })).json());
        const outsider = await person('Mallory');
        const answer = await step(outsider, settlement.id, { action: 'approve' });
        expect(answer.status).toBe(404);
        expect(ErrorBody.parse(await answer.json()).code).toBe('not_found');
    });
});

describe('group chat', () => {
    const send = async (user: Who, groupId: string, body: object) => messagesRoute.POST(post(`/api/v1/groups/${groupId}/messages`, await headersFor(user), body), { params: Promise.resolve({ groupId }) });
    const read = async (user: Who, groupId: string) => messagesRoute.GET(new Request(`https://splitit.test/api/v1/groups/${groupId}/messages`, { headers: await headersFor(user) }), { params: Promise.resolve({ groupId }) });

    it('sends, and reads back oldest first; an outsider sees nothing', async () => {
        const { alice, bob, group } = await dinnerOwed();
        const sent = await send(bob, group.id, { content: 'Who has the scooter keys?' });
        expect(sent.status).toBe(201);
        expect(MessageSent.parse(await sent.json()).message).toMatchObject({ senderId: bob.id, type: 'text' });
        await send(alice, group.id, { content: 'Me!' });

        const page = MessagePage.parse(await (await read(bob, group.id)).json());
        expect(page.messages.map((m) => m.content)).toEqual(['Who has the scooter keys?', 'Me!']);
        expect((await read(await person('Mallory'), group.id)).status).toBe(404);
    });

    it('slows down a flood, and reminds only members', async () => {
        const { bob, group } = await dinnerOwed();
        for (let i = 0; i < 5; i++) expect((await send(bob, group.id, { content: `hello ${i}` })).status).toBe(201);
        const sixth = await send(bob, group.id, { content: 'one more' });
        expect(sixth.status).toBe(429);
        expect(ErrorBody.parse(await sixth.json()).code).toBe('too_fast');

        // Checked before the flood limit: a reminder can only go to someone in the group.
        const stranger = await person('Mallory');
        const reminder = await send(bob, group.id, { content: 'Pay up', type: 'payment_reminder', targetUserId: stranger.id });
        expect(reminder.status).toBe(400);
        expect(ErrorBody.parse(await reminder.json()).code).toBe('bad_target');
    });
});
