import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ids, jsonRequest } from '../../helpers/http';

/*
 * A group's invite link works for 7 days (D-112). Anyone in the group renews an
 * expired one; only the owner or an admin ends one that still works, and anyone
 * else asking is given it back; an expired link neither lets anyone in nor
 * shows the group.
 */

const { auth, prisma, createAuditLog } = vi.hoisted(() => ({
    auth: vi.fn(),
    prisma: {
        user: { findUnique: vi.fn() },
        group: { findFirst: vi.fn(), updateMany: vi.fn(), findUniqueOrThrow: vi.fn() },
        groupMember: { create: vi.fn() },
        notification: { createMany: vi.fn() },
    },
    createAuditLog: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ auth }));
vi.mock('@/lib/db', () => ({ prisma }));
vi.mock('@/lib/auditLog', () => ({ createAuditLog }));

const invite = await import('@/app/api/groups/[groupId]/invite/route');
const join = await import('@/app/api/groups/join/route');
const detail = await import('@/app/api/groups/[groupId]/route');

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS);
const names: Record<string, string> = { [ids.alice]: 'Alice', [ids.bob]: 'Bob', [ids.stranger]: 'Sam' };

function signIn(userId: string) {
    auth.mockResolvedValue({ user: { email: `${userId}@example.com` } });
    prisma.user.findUnique.mockResolvedValue({ id: userId, name: names[userId], email: `${userId}@example.com` });
}

/** Alice owns the group; `callerRole` is the caller's own membership, as the route selects it. */
function groupWithLink(issuedAt: Date, callerRole: 'admin' | 'member' = 'member') {
    prisma.group.findFirst.mockResolvedValue({
        id: ids.group,
        ownerId: ids.alice,
        inviteCode: 'old-code',
        inviteCodeIssuedAt: issuedAt,
        members: [{ role: callerRole }],
    });
}

const newLink = () => invite.POST(
    new Request(`http://localhost/api/groups/${ids.group}/invite`, { method: 'POST' }),
    { params: Promise.resolve({ groupId: ids.group }) }
);

beforeEach(() => {
    prisma.group.updateMany.mockResolvedValue({ count: 1 });
});

afterEach(() => {
    vi.resetAllMocks();
});

describe('POST /api/groups/:groupId/invite', () => {
    it('lets the owner end a link that still works, and the new one works for 7 days', async () => {
        signIn(ids.alice);
        groupWithLink(daysAgo(1), 'admin');
        const issuedAt = new Date('2026-09-25T17:00:00.000Z');
        prisma.group.findUniqueOrThrow.mockResolvedValue({ inviteCode: 'new-code', inviteCodeIssuedAt: issuedAt });

        const res = await newLink();

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ inviteCode: 'new-code', inviteExpiresAt: '2026-10-02T17:00:00.000Z' });
        const update = prisma.group.updateMany.mock.calls[0][0];
        expect(update.where).toEqual({ id: ids.group, inviteCode: 'old-code' });
        expect(update.data.inviteCode).toMatch(/^[0-9a-f]{32}$/);
        expect(update.data.inviteCodeIssuedAt).toBeInstanceOf(Date);
        expect(createAuditLog).toHaveBeenCalledWith(expect.objectContaining({ entityType: 'group', entityId: ids.group, details: { change: 'invite_link', byUserId: ids.alice } }));
    });

    it('lets an admin who isn’t the owner end a link that still works', async () => {
        signIn(ids.bob);
        groupWithLink(daysAgo(1), 'admin');
        prisma.group.findUniqueOrThrow.mockResolvedValue({ inviteCode: 'new-code', inviteCodeIssuedAt: new Date() });

        expect((await newLink()).status).toBe(200);
    });

    it('gives a member back the link that still works, and ends nothing', async () => {
        signIn(ids.bob);
        const issuedAt = daysAgo(6.9);
        groupWithLink(issuedAt);

        const res = await newLink();

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({
            inviteCode: 'old-code',
            inviteExpiresAt: new Date(issuedAt.getTime() + 7 * DAY_MS).toISOString(),
        });
        expect(prisma.group.updateMany).not.toHaveBeenCalled();
        expect(createAuditLog).not.toHaveBeenCalled();
    });

    it('lets any member renew a link that has expired', async () => {
        signIn(ids.bob);
        groupWithLink(daysAgo(7));
        prisma.group.findUniqueOrThrow.mockResolvedValue({ inviteCode: 'new-code', inviteCodeIssuedAt: new Date() });

        const res = await newLink();

        expect(res.status).toBe(200);
        expect((await res.json()).inviteCode).toBe('new-code');
    });

    it('answers two renewals at once with one link: the code the group ends up with', async () => {
        signIn(ids.bob);
        groupWithLink(daysAgo(8));
        // Someone else replaced "old-code" a moment earlier: this update matches nothing.
        prisma.group.updateMany.mockResolvedValue({ count: 0 });
        prisma.group.findUniqueOrThrow.mockResolvedValue({ inviteCode: 'their-code', inviteCodeIssuedAt: new Date() });

        expect((await (await newLink()).json()).inviteCode).toBe('their-code');
        // The change was theirs, so it isn't recorded as this caller's.
        expect(createAuditLog).not.toHaveBeenCalled();
    });

    it('gives someone outside the group nothing', async () => {
        signIn(ids.stranger);
        prisma.group.findFirst.mockResolvedValue(null);

        const res = await newLink();

        expect(res.status).toBe(404);
        expect(prisma.group.findFirst.mock.calls[0][0].where).toEqual({
            id: ids.group,
            deletedAt: null,
            OR: [{ ownerId: ids.stranger }, { members: { some: { userId: ids.stranger } } }],
        });
        expect(prisma.group.updateMany).not.toHaveBeenCalled();
    });

    it('asks for a session', async () => {
        auth.mockResolvedValue(null);
        expect((await newLink()).status).toBe(401);
    });
});

describe('an invite link, opened', () => {
    const preview = (code: string) => join.GET(new Request(`http://localhost/api/groups/join?code=${code}`));
    const tapJoin = (code: string) => join.POST(jsonRequest('http://localhost/api/groups/join', { inviteCode: code }));

    function linkOfGoa(issuedAt: Date, memberIds: string[] = [ids.alice]) {
        prisma.group.findFirst.mockResolvedValue({
            id: ids.group,
            name: 'Goa',
            emoji: '🏖️',
            inviteCodeIssuedAt: issuedAt,
            _count: { members: memberIds.length },
            members: memberIds.map((userId) => ({ userId })),
        });
    }

    it('shows the group while the link works, and not when it was made', async () => {
        linkOfGoa(daysAgo(6));

        const res = await preview('old-code');

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.name).toBe('Goa');
        expect(body).not.toHaveProperty('inviteCodeIssuedAt');
    });

    it('shows nothing of the group once the link has expired', async () => {
        linkOfGoa(daysAgo(7));

        const res = await preview('old-code');

        expect(res.status).toBe(410);
        expect(JSON.stringify(await res.json())).not.toContain('Goa');
    });

    it('lets nobody in through an expired link', async () => {
        signIn(ids.bob);
        linkOfGoa(daysAgo(8));

        const res = await tapJoin('old-code');

        expect(res.status).toBe(410);
        expect((await res.json()).error).toMatch(/expired/);
        expect(prisma.groupMember.create).not.toHaveBeenCalled();
    });

    it('still takes someone already in the group to it', async () => {
        signIn(ids.bob);
        linkOfGoa(daysAgo(8), [ids.alice, ids.bob]);

        const res = await tapJoin('old-code');

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ message: 'Already a member', groupId: ids.group });
    });

    it('lets someone in while the link works', async () => {
        signIn(ids.bob);
        linkOfGoa(daysAgo(1));
        prisma.groupMember.create.mockResolvedValue({});

        expect((await tapJoin('old-code')).status).toBe(201);
    });
});

describe('GET /api/groups/:groupId', () => {
    function goaFor(issuedAt: Date) {
        signIn(ids.alice);
        prisma.group.findFirst.mockResolvedValue({
            id: ids.group,
            name: 'Goa',
            ownerId: ids.alice,
            inviteCode: 'old-code',
            inviteCodeIssuedAt: issuedAt,
            members: [],
            trips: [],
        });
        return detail.GET(new Request(`http://localhost/api/groups/${ids.group}`), { params: Promise.resolve({ groupId: ids.group }) });
    }

    it('hands out the link while it works, with when it stops', async () => {
        const issuedAt = daysAgo(2);
        const body = await (await goaFor(issuedAt)).json();

        expect(body.inviteCode).toBe('old-code');
        expect(body.inviteExpiresAt).toBe(new Date(issuedAt.getTime() + 7 * DAY_MS).toISOString());
    });

    it('hands out no code once the link has expired', async () => {
        const body = await (await goaFor(daysAgo(9))).json();

        expect(body.inviteCode).toBeNull();
        expect(body.inviteExpiresAt).toEqual(expect.any(String));
    });
});
