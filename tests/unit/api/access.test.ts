import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ids, jsonRequest } from '../../helpers/http';
import { ledgerQueries, type LedgerFixture } from '../../helpers/ledgerDb';

/*
 * Three ways a signed-in person could reach past their own groups: reading any
 * group's invite code, sending anyone a notification with any text and link,
 * and posting chat messages dressed as system messages or carrying another
 * group's money.
 */

const { auth, prisma } = vi.hoisted(() => ({
    auth: vi.fn(),
    prisma: {
        user: { findUnique: vi.fn(), findMany: vi.fn() },
        contact: { findFirst: vi.fn() },
        group: { findFirst: vi.fn(), findMany: vi.fn() },
        transaction: { findMany: vi.fn() },
        settlement: { findMany: vi.fn() },
        notification: { findFirst: vi.fn(), create: vi.fn() },
        groupMessage: { count: vi.fn(), create: vi.fn() },
    },
}));

vi.mock('@/lib/auth', () => ({ auth }));
vi.mock('@/lib/db', () => ({ prisma }));

const invite = await import('@/app/api/contacts/invite/route');
const notifications = await import('@/app/api/notifications/route');
const messages = await import('@/app/api/groups/[groupId]/messages/route');

// Bob and Carol each owe Alice ₹3 in Goa.
const goa: LedgerFixture = {
    groupId: ids.group,
    ownerId: ids.alice,
    memberIds: [ids.alice, ids.bob, ids.carol],
    names: { [ids.alice]: 'Alice', [ids.bob]: 'Bob', [ids.carol]: 'Carol' },
    trips: [{ id: ids.trip, isActive: true, day: 1 }],
    transactions: [{ id: 't1', tripId: ids.trip, payerId: ids.alice, amount: 900, splits: [[ids.alice, 300], [ids.bob, 300], [ids.carol, 300]] }],
};

function useLedger(fixture: LedgerFixture) {
    const queries = ledgerQueries(fixture);
    prisma.group.findMany.mockImplementation(queries.group.findMany);
    prisma.transaction.findMany.mockImplementation(queries.transaction.findMany);
    prisma.settlement.findMany.mockImplementation(queries.settlement.findMany);
    prisma.user.findMany.mockImplementation(queries.user.findMany);
}

beforeEach(() => {
    vi.stubEnv('NEXTAUTH_URL', 'https://splitx.example');
    auth.mockResolvedValue({ user: { email: 'alice@example.com' } });
    prisma.user.findUnique.mockResolvedValue({ id: ids.alice, name: 'Alice' });
    useLedger(goa);
});

afterEach(() => {
    vi.resetAllMocks();
    vi.unstubAllEnvs();
});

describe('POST /api/contacts/invite', () => {
    beforeEach(() => {
        prisma.contact.findFirst.mockResolvedValue({ id: 'ccontact0000001', name: 'Dev', email: 'dev@example.com' });
    });

    it('never hands out the invite code of a group the caller is not in', async () => {
        prisma.group.findFirst.mockResolvedValue(null);

        const res = await invite.POST(jsonRequest('http://localhost/api/contacts/invite', { contactId: 'ccontact0000001', groupId: ids.group }));

        expect(res.status).toBe(404);
        expect(JSON.stringify(await res.json())).not.toContain('/join/');
        expect(prisma.group.findFirst.mock.calls[0][0].where).toEqual({
            id: ids.group,
            deletedAt: null,
            OR: [{ ownerId: ids.alice }, { members: { some: { userId: ids.alice } } }],
        });
    });

    it('gives a member their own group’s link', async () => {
        prisma.group.findFirst.mockResolvedValue({ inviteCode: 'abc123' });

        const res = await invite.POST(jsonRequest('http://localhost/api/contacts/invite', { contactId: 'ccontact0000001', groupId: ids.group }));

        expect((await res.json()).inviteUrl).toBe('https://splitx.example/join/abc123');
    });
});

describe('POST /api/notifications', () => {
    const remind = (body: unknown) => notifications.POST(jsonRequest('http://localhost/api/notifications', body));

    beforeEach(() => {
        prisma.notification.findFirst.mockResolvedValue(null);
        prisma.notification.create.mockImplementation(async ({ data }) => ({ id: 'cnotif000000001', ...data }));
    });

    it('writes the reminder itself, from what the group’s plan says is owed', async () => {
        const res = await remind({
            userId: ids.carol,
            groupId: ids.group,
            title: 'Security alert',
            body: 'Sign in again at https://evil.example',
            link: 'https://evil.example',
            type: 'system',
        });

        expect(res.status).toBe(201);
        expect(prisma.notification.create.mock.calls[0][0].data).toEqual({
            user: { connect: { id: ids.carol } },
            actor: { connect: { id: ids.alice } },
            type: 'payment_reminder',
            title: 'Payment reminder',
            body: 'Alice is reminding you to pay ₹3 in Goa.',
            link: '/settlements',
        });
    });

    it('refuses a reminder to someone who owes the sender nothing', async () => {
        prisma.user.findUnique.mockResolvedValue({ id: ids.bob, name: 'Bob' });

        const res = await remind({ userId: ids.carol, groupId: ids.group });

        expect(res.status).toBe(400);
        expect(prisma.notification.create).not.toHaveBeenCalled();
    });

    it('refuses anyone outside the group', async () => {
        const res = await remind({ userId: ids.stranger, groupId: ids.group });

        expect(res.status).toBe(403);
        expect(prisma.notification.create).not.toHaveBeenCalled();
    });

    it('sends at most one reminder a minute to the same person', async () => {
        prisma.notification.findFirst.mockResolvedValue({ id: 'cnotif000000000' });

        const res = await remind({ userId: ids.carol, groupId: ids.group });

        expect(res.status).toBe(429);
    });
});

describe('POST /api/groups/:groupId/messages', () => {
    const send = (body: unknown) => messages.POST(
        jsonRequest(`http://localhost/api/groups/${ids.group}/messages`, body),
        { params: Promise.resolve({ groupId: ids.group }) }
    );

    beforeEach(() => {
        prisma.group.findFirst.mockResolvedValue({ id: ids.group, name: 'Goa', ownerId: ids.alice, members: [{ userId: ids.bob }] });
        prisma.groupMessage.count.mockResolvedValue(0);
        prisma.groupMessage.create.mockImplementation(async ({ data }) => ({ id: 'cmessage0000001', ...data }));
    });

    it('refuses a message dressed as a system message', async () => {
        const res = await send({ content: '✅ Alice confirmed receiving ₹5,000 from you.', type: 'system' });

        expect(res.status).toBe(400);
        expect(prisma.groupMessage.create).not.toHaveBeenCalled();
    });

    it('never attaches a settlement or an expense a person names', async () => {
        await send({ content: 'see this', settlementId: 'cothergroup0001', transactionId: 'cothergroup0002' });

        const data = prisma.groupMessage.create.mock.calls[0][0].data;
        expect(data).toEqual({ groupId: ids.group, senderId: ids.alice, content: 'see this', type: 'text' });
    });

    it('caps a message at 1,000 characters', async () => {
        const res = await send({ content: 'x'.repeat(1_001) });

        expect(res.status).toBe(400);
    });
});
