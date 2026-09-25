import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { jsonRequest } from '../helpers/http';
import { emptyDatabase, groupOf, person, sessionOf } from './fixtures';

// Invite links on a real Postgres (D-112): the new column's default, the 7 days,
// and two people renewing one expired link at the same moment, which only the
// database's row locks decide.

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock('@/lib/auth', () => ({ auth }));

const join = await import('@/app/api/groups/join/route');
const invite = await import('@/app/api/groups/[groupId]/invite/route');

beforeEach(emptyDatabase);
afterAll(() => prisma.$disconnect());

const DAY_MS = 24 * 60 * 60 * 1000;
const tapJoin = (code: string) => join.POST(jsonRequest('http://localhost/api/groups/join', { inviteCode: code }));
const preview = (code: string) => join.GET(new Request(`http://localhost/api/groups/join?code=${code}`));
const newLink = (groupId: string) => invite.POST(
    new Request(`http://localhost/api/groups/${groupId}/invite`, { method: 'POST' }),
    { params: Promise.resolve({ groupId }) }
);
/** Moves a group's link back in time, as the days going by would. */
const ageLink = (groupId: string, days: number) =>
    prisma.group.update({ where: { id: groupId }, data: { inviteCodeIssuedAt: new Date(Date.now() - days * DAY_MS) } });

describe('invite links', () => {
    it('a new group’s link works at once, and not after 7 days', async () => {
        const [alice, bob] = [await person('Alice'), await person('Bob')];
        const { group } = await groupOf(alice, []);
        auth.mockResolvedValue(sessionOf(bob));

        expect((await preview(group.inviteCode)).status).toBe(200);

        await ageLink(group.id, 7);
        expect((await preview(group.inviteCode)).status).toBe(410);
        expect((await tapJoin(group.inviteCode)).status).toBe(410);
        expect(await prisma.groupMember.count({ where: { groupId: group.id, userId: bob.id } })).toBe(0);
    });

    it('the owner’s new link lets people in, and the old one then leads nowhere', async () => {
        const [alice, bob] = [await person('Alice'), await person('Bob')];
        const { group } = await groupOf(alice, []);

        auth.mockResolvedValue(sessionOf(alice));
        const { inviteCode } = await (await newLink(group.id)).json();
        expect(inviteCode).not.toBe(group.inviteCode);

        auth.mockResolvedValue(sessionOf(bob));
        expect((await tapJoin(group.inviteCode)).status).toBe(404);
        expect((await tapJoin(inviteCode)).status).toBe(201);
    });

    it('two members renewing an expired link at once get the same one, and it works', async () => {
        for (let round = 0; round < 5; round++) {
            await emptyDatabase();
            const [alice, bob, carol, dev] = [await person('Alice'), await person('Bob'), await person('Carol'), await person('Dev')];
            const { group } = await groupOf(alice, [bob, carol]);
            await ageLink(group.id, 8);

            auth.mockResolvedValueOnce(sessionOf(bob)).mockResolvedValueOnce(sessionOf(carol));
            const answers = await Promise.all([newLink(group.id), newLink(group.id)]);
            const codes = await Promise.all(answers.map(async (answer) => (await answer.json()).inviteCode));

            expect(answers.map((answer) => answer.status)).toEqual([200, 200]);
            expect(codes[0]).toBe(codes[1]);
            const stored = await prisma.group.findUniqueOrThrow({ where: { id: group.id } });
            expect(stored.inviteCode).toBe(codes[0]);

            auth.mockResolvedValue(sessionOf(dev));
            expect((await tapJoin(codes[0])).status).toBe(201);
        }
    });
});
