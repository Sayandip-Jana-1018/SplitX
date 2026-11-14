import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SyncAnswer } from '@/lib/contract/v1';
import { prisma } from '@/lib/db';
import { balanceOf, loadGroupLedger } from '@/lib/ledger';
import { startSession } from '@/lib/mobileAuth';
import { emptyDatabase, expense, groupOf, person } from './fixtures';

const syncRoute = await import('@/app/api/v1/sync/route');

beforeAll(() => {
    process.env.MOBILE_TOKEN_SECRET = 'a-database-test-secret-of-32-characters-or-more';
});
beforeEach(emptyDatabase);
afterAll(() => prisma.$disconnect());

async function bearerFor(user: { id: string }) {
    const { accessToken } = await startSession(user.id, { platform: 'android' });
    return { authorization: `Bearer ${accessToken}` };
}

async function sync(user: { id: string }, known: Record<string, string> = {}) {
    const response = await syncRoute.POST(new Request('https://splitit.test/api/v1/sync', { method: 'POST', headers: { ...(await bearerFor(user)), 'content-type': 'application/json' }, body: JSON.stringify({ known }) }));
    expect(response.status).toBe(200);
    return SyncAnswer.parse(await response.json());
}

const versions = (answer: SyncAnswer) => Object.fromEntries(answer.changed.map((group) => [group.id, group.version]));

/** Goa: Alice, Bob and Carol, two expenses and a settlement. Flat: Alice and Dev, nothing yet. */
async function twoGroups() {
    const alice = await person('Alice');
    const bob = await person('Bob');
    const carol = await person('Carol');
    const dev = await person('Dev');
    const goa = await groupOf(alice, [bob, carol]);
    const flat = await groupOf(alice, [dev]);
    const lunch = await expense(goa.trip.id, alice, 900, [alice, bob, carol]);
    await expense(goa.trip.id, bob, 300, [alice, bob]);
    await prisma.settlement.create({ data: { tripId: goa.trip.id, fromId: carol.id, toId: alice.id, amount: 100, status: 'completed' } });
    return { alice, bob, carol, dev, goa, flat, lunch };
}

describe('the first sync', () => {
    it('sends every group you’re in, whole, and nothing of anyone else’s', async () => {
        const { alice, dev, goa, flat } = await twoGroups();
        const first = await sync(alice);
        expect(new Set(first.groupIds)).toEqual(new Set([goa.group.id, flat.group.id]));
        const sent = first.changed.find((group) => group.id === goa.group.id)!;
        expect(sent.expenses.map((e) => e.amount)).toEqual([900, 300]);
        expect(sent.expenses[0].splits.reduce((sum, split) => sum + split.amount, 0)).toBe(900);
        expect(sent.settlements).toHaveLength(1);
        expect(sent.people.map((p) => p.name).sort()).toEqual(['Alice', 'Bob', 'Carol']);

        const devs = await sync(dev);
        expect(devs.groupIds).toEqual([flat.group.id]);
        expect(devs.changed.map((group) => group.id)).toEqual([flat.group.id]);
    });

    it('answers 401 without a token and 400 for a body it can’t read', async () => {
        const { alice } = await twoGroups();
        expect((await syncRoute.POST(new Request('https://splitit.test/api/v1/sync', { method: 'POST', body: '{}' }))).status).toBe(401);
        const bad = await syncRoute.POST(new Request('https://splitit.test/api/v1/sync', { method: 'POST', headers: { ...(await bearerFor(alice)), 'content-type': 'application/json' }, body: JSON.stringify({ known: 'everything' }) }));
        expect(bad.status).toBe(400);
    });
});

describe('later syncs', () => {
    it('send nothing when nothing changed', async () => {
        const { alice } = await twoGroups();
        const first = await sync(alice);
        const again = await sync(alice, versions(first));
        expect(again.changed).toEqual([]);
        expect(again.groupIds).toEqual(first.groupIds);
    });

    it('send a group again, and only that group, after an expense is added, deleted or a payment moves', async () => {
        const { alice, bob, dev, goa, flat, lunch } = await twoGroups();
        let known = versions(await sync(alice));

        await expense(goa.trip.id, bob, 600, [alice, bob]);
        let next = await sync(alice, known);
        expect(next.changed.map((group) => group.id)).toEqual([goa.group.id]);
        known = { ...known, ...versions(next) };

        // Deleted on the website: the group comes back without it.
        await prisma.transaction.update({ where: { id: lunch.id }, data: { deletedAt: new Date() } });
        next = await sync(alice, known);
        expect(next.changed.map((group) => group.id)).toEqual([goa.group.id]);
        expect(next.changed[0].expenses.map((e) => e.id)).not.toContain(lunch.id);
        known = { ...known, ...versions(next) };

        const pending = await prisma.settlement.create({ data: { tripId: flat.trip.id, fromId: alice.id, toId: dev.id, amount: 250, status: 'pending' } });
        next = await sync(alice, known);
        expect(next.changed.map((group) => group.id)).toEqual([flat.group.id]);
        known = { ...known, ...versions(next) };

        await prisma.settlement.update({ where: { id: pending.id }, data: { status: 'completed' } });
        next = await sync(alice, known);
        expect(next.changed.map((group) => group.id)).toEqual([flat.group.id]);
        expect(next.changed[0].settlements[0].status).toBe('completed');
    });

    it('send a group again when someone in it changes their name or UPI ID', async () => {
        const { alice, carol, goa } = await twoGroups();
        const known = versions(await sync(alice));
        await prisma.user.update({ where: { id: carol.id }, data: { upiId: 'carol@okbank' } });
        const next = await sync(alice, known);
        expect(next.changed.map((group) => group.id)).toEqual([goa.group.id]);
        expect(next.changed[0].people.find((p) => p.id === carol.id)?.upiId).toBe('carol@okbank');
    });

    it('drop a group you’ve left, and keep someone who left but still owes, by name', async () => {
        const { alice, carol, goa } = await twoGroups();
        const known = versions(await sync(alice));
        await prisma.groupMember.deleteMany({ where: { groupId: goa.group.id, userId: carol.id } });

        const carols = await sync(carol, {});
        expect(carols.groupIds).not.toContain(goa.group.id);

        const alices = await sync(alice, known);
        const sent = alices.changed.find((group) => group.id === goa.group.id)!;
        const former = sent.people.find((p) => p.id === carol.id);
        expect(former).toMatchObject({ name: 'Carol', isMember: false });
    });
});

describe('what the phone works out from a sync', () => {
    it('matches the website’s balances to the paisa', async () => {
        const { alice, goa } = await twoGroups();
        const sent = (await sync(alice)).changed.find((group) => group.id === goa.group.id)!;
        const ledger = (await loadGroupLedger(goa.group.id))!;
        const { accountLedger } = await import('../../apps/mobile/src/data/account');
        const { groupBalances } = await import('../../apps/mobile/src/data/ledger');
        const mine = accountLedger([sent], alice.id);
        const balances = groupBalances(mine, goa.group.id);
        for (const person of sent.people) {
            const key = person.id === alice.id ? 'me' : person.id;
            expect(balances[key] ?? 0).toBe(balanceOf(ledger, person.id));
        }
    });
});
