import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ErrorBody, GroupJoined, GroupMade, InviteLink, SyncAnswer } from '@/lib/contract/v1';
import { prisma } from '@/lib/db';
import { startSession } from '@/lib/mobileAuth';
import { emptyDatabase, groupOf, person } from './fixtures';

const groupsRoute = await import('@/app/api/v1/groups/route');
const joinRoute = await import('@/app/api/v1/groups/join/route');
const inviteRoute = await import('@/app/api/v1/groups/[groupId]/invite/route');
const syncRoute = await import('@/app/api/v1/sync/route');

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
