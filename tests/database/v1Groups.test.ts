import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ErrorBody, GroupJoined, GroupMade, GroupReceipts, InviteLink, InvitePreview, SyncAnswer } from '@/lib/contract/v1';
import { prisma } from '@/lib/db';
import { startSession } from '@/lib/mobileAuth';
import { emptyDatabase, expense, groupOf, person } from './fixtures';

const groupsRoute = await import('@/app/api/v1/groups/route');
const joinRoute = await import('@/app/api/v1/groups/join/route');
const inviteRoute = await import('@/app/api/v1/groups/[groupId]/invite/route');
const syncRoute = await import('@/app/api/v1/sync/route');
const groupRoute = await import('@/app/api/v1/groups/[groupId]/route');
const memberRoute = await import('@/app/api/v1/groups/[groupId]/members/[userId]/route');
const receiptsRoute = await import('@/app/api/v1/groups/[groupId]/receipts/route');

beforeAll(() => {
    process.env.MOBILE_TOKEN_SECRET = 'a-database-test-secret-of-32-characters-or-more';
});
beforeEach(emptyDatabase);
afterAll(() => prisma.$disconnect());

async function headersFor(user: { id: string }) {
    const { accessToken } = await startSession(user.id, { platform: 'android' });
    return { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' };
}

const post = async (user: { id: string }, path: string, body: unknown = {}) =>
    new Request(`https://splitit.test${path}`, { method: 'POST', headers: await headersFor(user), body: JSON.stringify(body) });

const params = (groupId: string) => ({ params: Promise.resolve({ groupId }) });

describe('making a group from the phone', () => {
    it('makes you its admin, with a trip ready, and the next sync brings it', async () => {
        const asha = await person('Asha');
        const made = await groupsRoute.POST(await post(asha, '/api/v1/groups', { name: 'Hampi', emoji: '🏛️' }));
        expect(made.status).toBe(201);
        const { groupId } = GroupMade.parse(await made.json());

        const member = await prisma.groupMember.findFirstOrThrow({ where: { groupId, userId: asha.id } });
        expect(member.role).toBe('admin');
        expect(await prisma.trip.count({ where: { groupId } })).toBe(1);

        const synced = SyncAnswer.parse(await (await syncRoute.POST(await post(asha, '/api/v1/sync', { known: {} }))).json());
        expect(synced.changed.find((group) => group.id === groupId)).toMatchObject({ name: 'Hampi', emoji: '🏛️' });
    });

    it('refuses a group with no name', async () => {
        const asha = await person('Asha');
        const answer = await groupsRoute.POST(await post(asha, '/api/v1/groups', { name: '   ' }));
        expect(answer.status).toBe(400);
    });
});

describe('joining by invite code', () => {
    it('joins once, then says you’re already in', async () => {
        const asha = await person('Asha');
        const ravi = await person('Ravi');
        const { group } = await groupOf(asha, []);
        const first = await joinRoute.POST(await post(ravi, '/api/v1/groups/join', { inviteCode: group.inviteCode }));
        expect(first.status).toBe(201);
        expect(GroupJoined.parse(await first.json())).toEqual({ groupId: group.id, joined: true });
        const again = await joinRoute.POST(await post(ravi, '/api/v1/groups/join', { inviteCode: group.inviteCode }));
        expect(again.status).toBe(200);
        expect(GroupJoined.parse(await again.json()).joined).toBe(false);
    });

    it('answers 404 for a code that never was and 410 for an expired one', async () => {
        const asha = await person('Asha');
        const ravi = await person('Ravi');
        const { group } = await groupOf(asha, []);
        const nowhere = await joinRoute.POST(await post(ravi, '/api/v1/groups/join', { inviteCode: 'not-a-code' }));
        expect(nowhere.status).toBe(404);
        expect(ErrorBody.parse(await nowhere.json()).code).toBe('invalid_invite');

        await prisma.group.update({ where: { id: group.id }, data: { inviteCodeIssuedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) } });
        const old = await joinRoute.POST(await post(ravi, '/api/v1/groups/join', { inviteCode: group.inviteCode }));
        expect(old.status).toBe(410);
        expect(ErrorBody.parse(await old.json()).code).toBe('invite_expired');
    });
});

describe('a link to share', () => {
    it('keeps the link already out, even for the admin, and renews an expired one', async () => {
        const asha = await person('Asha');
        const { group } = await groupOf(asha, []);
        const shared = InviteLink.parse(await (await inviteRoute.POST(await post(asha, `/api/v1/groups/${group.id}/invite`), params(group.id))).json());
        expect(shared.inviteCode).toBe(group.inviteCode);
        expect(shared.url).toBe(`https://splitit.test/join/${group.inviteCode}`);

        await prisma.group.update({ where: { id: group.id }, data: { inviteCodeIssuedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) } });
        const renewed = InviteLink.parse(await (await inviteRoute.POST(await post(asha, `/api/v1/groups/${group.id}/invite`), params(group.id))).json());
        expect(renewed.inviteCode).not.toBe(group.inviteCode);
        expect(new Date(renewed.expiresAt).getTime()).toBeGreaterThan(Date.now());
    });

    it('answers 404 for a group you aren’t in', async () => {
        const asha = await person('Asha');
        const mallory = await person('Mallory');
        const { group } = await groupOf(asha, []);
        expect((await inviteRoute.POST(await post(mallory, `/api/v1/groups/${group.id}/invite`), params(group.id))).status).toBe(404);
    });
});

describe('a link’s preview, before joining', () => {
    const get = async (user: { id: string }, code: string) => {
        const { authorization } = await headersFor(user);
        return joinRoute.GET(new Request(`https://splitit.test/api/v1/groups/join?code=${encodeURIComponent(code)}`, { headers: { authorization } }));
    };

    it('shows the group’s name and size, and whether you’re in it', async () => {
        const asha = await person('Asha');
        const ravi = await person('Ravi');
        const { group } = await groupOf(asha, []);
        const seen = InvitePreview.parse(await (await get(ravi, group.inviteCode)).json());
        expect(seen).toMatchObject({ groupId: group.id, name: 'Goa', members: 1, alreadyIn: false });
        expect(InvitePreview.parse(await (await get(asha, group.inviteCode)).json()).alreadyIn).toBe(true);
    });

    it('shows nothing of a group whose link expired, and 404 for no group', async () => {
        const asha = await person('Asha');
        const ravi = await person('Ravi');
        const { group } = await groupOf(asha, []);
        expect((await get(ravi, 'nope-nope')).status).toBe(404);
        await prisma.group.update({ where: { id: group.id }, data: { inviteCodeIssuedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) } });
        const old = await get(ravi, group.inviteCode);
        expect(old.status).toBe(410);
        expect(JSON.stringify(await old.json())).not.toContain('Goa');
    });
});

const removing = async (by: { id: string }, groupId: string, userId: string) =>
    memberRoute.DELETE(new Request(`https://splitit.test/api/v1/groups/${groupId}/members/${userId}`, { method: 'DELETE', headers: await headersFor(by) }), { params: Promise.resolve({ groupId, userId }) });
const deleting = async (by: { id: string }, groupId: string) =>
    groupRoute.DELETE(new Request(`https://splitit.test/api/v1/groups/${groupId}`, { method: 'DELETE', headers: await headersFor(by) }), params(groupId));

describe('removing someone from a group', () => {
    it('lets the owner remove someone square, and changes the invite code', async () => {
        const asha = await person('Asha');
        const ravi = await person('Ravi');
        const { group } = await groupOf(asha, [ravi]);
        expect((await removing(asha, group.id, ravi.id)).status).toBe(204);
        expect(await prisma.groupMember.count({ where: { groupId: group.id, userId: ravi.id } })).toBe(0);
        expect((await prisma.group.findUniqueOrThrow({ where: { id: group.id } })).inviteCode).not.toBe(group.inviteCode);
    });

    it('refuses while they owe or are owed, says how much, and keeps them', async () => {
        const asha = await person('Asha');
        const ravi = await person('Ravi');
        const { group, trip } = await groupOf(asha, [ravi]);
        await expense(trip.id, asha, 1000, [asha, ravi]);
        const answer = await removing(asha, group.id, ravi.id);
        expect(answer.status).toBe(409);
        const body = ErrorBody.parse(await answer.json());
        expect(body.code).toBe('not_settled');
        expect(body.error).toContain('Ravi still owes');
        expect(await prisma.groupMember.count({ where: { groupId: group.id, userId: ravi.id } })).toBe(1);
    });

    it('lets no ordinary member remove anyone, and nobody the owner', async () => {
        const asha = await person('Asha');
        const ravi = await person('Ravi');
        const meera = await person('Meera');
        const { group } = await groupOf(asha, [ravi, meera]);
        expect((await removing(ravi, group.id, meera.id)).status).toBe(403);
        expect(ErrorBody.parse(await (await removing(asha, group.id, asha.id)).json()).code).toBe('owner');
    });
});

describe('deleting a group from the phone', () => {
    it('lets the owner delete a group where everyone is square', async () => {
        const asha = await person('Asha');
        const ravi = await person('Ravi');
        const { group } = await groupOf(asha, [ravi]);
        expect((await deleting(ravi, group.id)).status).toBe(403);
        expect((await deleting(asha, group.id)).status).toBe(204);
        expect((await prisma.group.findUniqueOrThrow({ where: { id: group.id } })).deletedAt).not.toBeNull();
        expect((await deleting(asha, group.id)).status).toBe(404);
    });

    it('refuses while anyone owes anyone, and keeps everything', async () => {
        const asha = await person('Asha');
        const ravi = await person('Ravi');
        const { group, trip } = await groupOf(asha, [ravi]);
        await expense(trip.id, ravi, 600, [asha, ravi]);
        const answer = await deleting(asha, group.id);
        expect(answer.status).toBe(409);
        expect(ErrorBody.parse(await answer.json()).code).toBe('not_settled');
        expect((await prisma.group.findUniqueOrThrow({ where: { id: group.id } })).deletedAt).toBeNull();
    });
});

describe('a group’s receipts', () => {
    it('answers the people in it, with nothing when no expense has a photo, and nobody else', async () => {
        const asha = await person('Asha');
        const ravi = await person('Ravi');
        const stranger = await person('Stranger');
        const { group, trip } = await groupOf(asha, [ravi]);
        await expense(trip.id, asha, 600, [asha, ravi]);
        const read = async (who: { id: string }) => receiptsRoute.GET(new Request(`https://splitit.test/api/v1/groups/${group.id}/receipts`, { headers: await headersFor(who) }), params(group.id));

        const mine = await read(ravi);
        expect(mine.status).toBe(200);
        expect(GroupReceipts.parse(await mine.json())).toEqual({ receipts: [] });
        expect((await read(stranger)).status).toBe(404);
    });
});
