import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ActivityPage, GroupDetail, GroupList } from '@/lib/contract/v1';
import { prisma } from '@/lib/db';
import { balanceOf, loadGroupLedger } from '@/lib/ledger';
import { startSession } from '@/lib/mobileAuth';
import { emptyDatabase, expense, groupOf, person } from './fixtures';

const groupsRoute = await import('@/app/api/v1/groups/route');
const groupRoute = await import('@/app/api/v1/groups/[groupId]/route');
const activityRoute = await import('@/app/api/v1/activity/route');

beforeAll(() => {
    process.env.MOBILE_TOKEN_SECRET = 'a-database-test-secret-of-32-characters-or-more';
});
beforeEach(emptyDatabase);
afterAll(() => prisma.$disconnect());

async function bearerFor(user: { id: string }) {
    const { accessToken } = await startSession(user.id, { platform: 'android' });
    return { authorization: `Bearer ${accessToken}` };
}

const get = (path: string, headers: Record<string, string>) => new Request(`https://splitit.test${path}`, { headers });
const params = (groupId: string) => ({ params: Promise.resolve({ groupId }) });

/** Alice paid 900 for three, Bob paid 300 for Alice and Bob; Carol settled 100 with Alice. */
async function goaTrip() {
    const alice = await person('Alice');
    const bob = await person('Bob');
    const carol = await person('Carol');
    const outsider = await person('Mallory');
    const { group, trip } = await groupOf(alice, [bob, carol]);
    await expense(trip.id, alice, 900, [alice, bob, carol]);
    await expense(trip.id, bob, 300, [alice, bob]);
    await prisma.settlement.create({ data: { tripId: trip.id, fromId: carol.id, toId: alice.id, amount: 100, status: 'completed' } });
    await prisma.settlement.create({ data: { tripId: trip.id, fromId: bob.id, toId: alice.id, amount: 50, status: 'pending' } });
    return { alice, bob, carol, outsider, group, trip };
}

describe('who can read what', () => {
    it('lists only your own groups', async () => {
        const { alice, outsider, group } = await goaTrip();
        const mine = GroupList.parse(await (await groupsRoute.GET(get('/api/v1/groups', await bearerFor(alice)))).json());
        expect(mine.groups.map((g) => g.id)).toEqual([group.id]);
        const theirs = GroupList.parse(await (await groupsRoute.GET(get('/api/v1/groups', await bearerFor(outsider)))).json());
        expect(theirs.groups).toEqual([]);
    });

    it('answers 404 for a group you aren’t in, and for its activity, exactly as for one that doesn’t exist', async () => {
        const { outsider, group } = await goaTrip();
        const headers = await bearerFor(outsider);
        const notMine = await groupRoute.GET(get(`/api/v1/groups/${group.id}`, headers), params(group.id));
        const nowhere = await groupRoute.GET(get('/api/v1/groups/nope', headers), params('nope'));
        expect([notMine.status, nowhere.status]).toEqual([404, 404]);
        expect(await notMine.json()).toEqual(await nowhere.json());
        expect((await activityRoute.GET(get(`/api/v1/activity?groupId=${group.id}`, headers))).status).toBe(404);
    });

    it('answers 401 without a token, everywhere', async () => {
        const { group } = await goaTrip();
        expect((await groupsRoute.GET(get('/api/v1/groups', {}))).status).toBe(401);
        expect((await groupRoute.GET(get(`/api/v1/groups/${group.id}`, {}), params(group.id))).status).toBe(401);
        expect((await activityRoute.GET(get('/api/v1/activity', {}))).status).toBe(401);
    });
});

describe('balances', () => {
    it('are the website’s own, to the paisa, and the plan settles them', async () => {
        const { alice, bob, carol, group } = await goaTrip();
        const detail = GroupDetail.parse(await (await groupRoute.GET(get(`/api/v1/groups/${group.id}`, await bearerFor(alice)), params(group.id))).json());
        const ledger = (await loadGroupLedger(group.id))!;

        for (const who of [alice, bob, carol]) {
            expect(detail.people.find((p) => p.id === who.id)?.balance).toBe(balanceOf(ledger, who.id));
        }
        // Money is only moved between people: everyone's balances add up to nothing.
        expect(detail.people.reduce((sum, p) => sum + p.balance, 0)).toBe(0);
        expect(detail.group.myBalance).toBe(balanceOf(ledger, alice.id));
        expect(detail.group.totalSpent).toBe(1200);

        // Paying the planned transfers leaves everyone at zero.
        const after = new Map(detail.people.map((p) => [p.id, p.balance]));
        for (const t of detail.transfers) {
            after.set(t.fromId, (after.get(t.fromId) ?? 0) + t.amount);
            after.set(t.toId, (after.get(t.toId) ?? 0) - t.amount);
        }
        expect([...after.values()].every((balance) => balance === 0)).toBe(true);
    });
});

describe('activity', () => {
    it('says what each item did to your balance, and pending settlements nothing yet', async () => {
        const { alice, group } = await goaTrip();
        const page = ActivityPage.parse(await (await activityRoute.GET(get(`/api/v1/activity?groupId=${group.id}`, await bearerFor(alice)))).json());
        const byKind = (kind: string, amount: number) => page.items.find((item) => item.kind === kind && item.amount === amount)!;

        expect(byKind('expense', 900).yours).toBe(900 - 300); // paid it all, owes a third
        expect(byKind('expense', 300).yours).toBe(-150); // Bob paid, Alice's half
        expect(byKind('settlement', 100).yours).toBe(-100); // Carol paid Alice: Alice is owed less
        expect(byKind('settlement', 50)).toMatchObject({ yours: 0, status: 'pending' });

        // Moving by every item's `yours` lands on Alice's balance.
        const ledger = (await loadGroupLedger(group.id))!;
        expect(page.items.reduce((sum, item) => sum + item.yours, 0)).toBe(balanceOf(ledger, alice.id));
    });

    it('pages through items that share a time without skipping or repeating any', async () => {
        const alice = await person('Alice');
        const { trip } = await groupOf(alice, []);
        const at = new Date('2026-11-01T10:00:00.000Z');
        for (let i = 0; i < 7; i++) {
            await prisma.transaction.create({
                data: { tripId: trip.id, payerId: alice.id, amount: 100 + i, title: `Same moment ${i}`, splits: { create: [{ userId: alice.id, amount: 100 + i }] }, createdAt: at },
            });
        }
        const headers = await bearerFor(alice);
        const seen: string[] = [];
        let before: string | null = null;
        do {
            const query: string = `/api/v1/activity?limit=3${before ? `&before=${encodeURIComponent(before)}` : ''}`;
            const page = ActivityPage.parse(await (await activityRoute.GET(get(query, headers))).json());
            seen.push(...page.items.map((item) => item.id));
            before = page.nextBefore;
        } while (before);
        expect(seen).toHaveLength(7);
        expect(new Set(seen).size).toBe(7);
    });

    it('refuses a malformed request', async () => {
        const alice = await person('Alice');
        expect((await activityRoute.GET(get('/api/v1/activity?limit=5000', await bearerFor(alice)))).status).toBe(400);
    });
});
