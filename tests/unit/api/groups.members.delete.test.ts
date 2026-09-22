import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { ids, jsonRequest } from '../../helpers/http';
import { ledgerQueries, runTransactionsOn, type LedgerFixture } from '../../helpers/ledgerDb';

const { auth, prisma, tx } = vi.hoisted(() => ({
    auth: vi.fn(),
    prisma: {
        user: { findUnique: vi.fn() },
        group: { findFirst: vi.fn() },
        notification: { deleteMany: vi.fn(), create: vi.fn(), createMany: vi.fn() },
        $transaction: vi.fn(),
    },
    tx: {} as Record<string, unknown>,
}));

vi.mock('@/lib/auth', () => ({ auth }));
vi.mock('@/lib/db', () => ({ prisma }));
vi.mock('@/lib/auditLog', () => ({ createAuditLog: vi.fn() }));

const { DELETE } = await import('@/app/api/groups/[groupId]/members/route');

const names: Record<string, string> = { [ids.alice]: 'Alice', [ids.bob]: 'Bob', [ids.carol]: 'Carol' };
const baseFixture: LedgerFixture = {
    groupId: ids.group,
    ownerId: ids.alice,
    memberIds: [ids.alice, ids.bob, ids.carol],
    names,
    trips: [{ id: 'trip-old', isActive: false, day: 1 }, { id: ids.trip, isActive: true, day: 2 }],
};

function useLedger(fixture: Partial<LedgerFixture>) {
    const queries = ledgerQueries({ ...baseFixture, ...fixture });
    Object.assign(tx, queries, {
        groupMember: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
        group: { ...queries.group, update: vi.fn().mockResolvedValue({}) },
    });
}

function remove(userId: unknown, signedInAs: string = ids.alice) {
    prisma.user.findUnique.mockResolvedValue({ id: signedInAs, name: names[signedInAs], email: `${signedInAs}@example.com` });
    return DELETE(
        jsonRequest(`http://localhost/api/groups/${ids.group}/members`, { userId }, { method: 'DELETE' }),
        { params: Promise.resolve({ groupId: ids.group }) }
    );
}

const txClient = tx as unknown as { groupMember: { deleteMany: ReturnType<typeof vi.fn> }; group: { update: ReturnType<typeof vi.fn> } };

beforeEach(() => {
    auth.mockResolvedValue({ user: { email: 'someone@example.com' } });
    prisma.group.findFirst.mockResolvedValue({
        id: ids.group,
        name: 'Goa',
        ownerId: ids.alice,
        members: [
            { userId: ids.alice, role: 'admin' },
            { userId: ids.bob, role: 'member' },
            { userId: ids.carol, role: 'member' },
        ],
    });
    prisma.$transaction.mockImplementation(runTransactionsOn(tx));
    prisma.notification.deleteMany.mockResolvedValue({ count: 0 });
    prisma.notification.create.mockResolvedValue({});
    prisma.notification.createMany.mockResolvedValue({ count: 1 });
});

afterEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(tx)) delete tx[key];
});

describe('DELETE /api/groups/:groupId/members', () => {
    it('refuses to remove someone who still owes, even when the debt is on an older trip', async () => {
        useLedger({
            transactions: [{ id: 't1', tripId: 'trip-old', payerId: ids.alice, amount: 900, splits: [[ids.alice, 300], [ids.bob, 300], [ids.carol, 300]] }],
        });

        const res = await remove(ids.carol);

        expect(res.status).toBe(409);
        expect(await res.json()).toEqual({ error: 'Carol still owes ₹3 in this group. Settle up first, then remove them.' });
        expect(txClient.groupMember.deleteMany).not.toHaveBeenCalled();
    });

    it('refuses to remove someone the group still owes', async () => {
        useLedger({
            transactions: [{ id: 't1', tripId: ids.trip, payerId: ids.bob, amount: 600, splits: [[ids.alice, 300], [ids.bob, 300]] }],
        });

        const res = await remove(ids.bob);

        expect(res.status).toBe(409);
        expect((await res.json()).error).toBe('Bob is still owed ₹3 in this group. Settle up first, then remove them.');
    });

    it('refuses while a settlement of theirs is still waiting', async () => {
        useLedger({
            settlements: [{ id: 's1', tripId: ids.trip, fromId: ids.carol, toId: ids.alice, amount: 300, status: 'paid_pending' }],
        });

        const res = await remove(ids.carol);

        expect(res.status).toBe(409);
        expect((await res.json()).error).toBe('Carol has 1 settlement still waiting. Complete or cancel them first.');
        expect(txClient.groupMember.deleteMany).not.toHaveBeenCalled();
    });

    it('removes a member who is square, leaves every share alone, and changes the invite link', async () => {
        useLedger({
            transactions: [{ id: 't1', tripId: ids.trip, payerId: ids.alice, amount: 600, splits: [[ids.alice, 300], [ids.carol, 300]] }],
            settlements: [{ id: 's1', tripId: 'trip-old', fromId: ids.carol, toId: ids.alice, amount: 300, status: 'completed' }],
        });

        const res = await remove(ids.carol);

        expect(res.status).toBe(200);
        expect(txClient.groupMember.deleteMany).toHaveBeenCalledWith({ where: { groupId: ids.group, userId: ids.carol } });
        const newCode = txClient.group.update.mock.calls[0][0].data.inviteCode;
        expect(newCode).toMatch(/^[0-9a-f]{32}$/);
        expect(newCode).not.toBe('old-invite-code');
        // The check and the removal share one serializable transaction.
        expect(prisma.$transaction.mock.calls[0][1]).toEqual({ isolationLevel: 'Serializable' });
        // No split or expense is rewritten: the transaction client has no such methods to call.
        expect(Object.keys(tx)).not.toContain('splitItem');
    });

    it('asks to try again when a change at the same moment wins', async () => {
        prisma.$transaction.mockRejectedValue(
            new Prisma.PrismaClientKnownRequestError('write conflict', { code: 'P2034', clientVersion: 'test' })
        );

        const res = await remove(ids.carol);

        expect(res.status).toBe(409);
        expect((await res.json()).error).toBe('The group changed while removing this member. Please try again.');
    });

    it('lets only the owner or an admin remove people', async () => {
        const res = await remove(ids.carol, ids.bob);
        expect(res.status).toBe(403);
        expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it.each([
        ['the owner', ids.alice, 400],
        ['someone outside the group', ids.stranger, 404],
    ])('refuses removing %s', async (_, target, status) => {
        const res = await remove(target);
        expect(res.status).toBe(status);
        expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('refuses an admin removing themselves', async () => {
        prisma.group.findFirst.mockResolvedValue({
            id: ids.group,
            name: 'Goa',
            ownerId: ids.alice,
            members: [{ userId: ids.alice, role: 'admin' }, { userId: ids.bob, role: 'admin' }],
        });
        const res = await remove(ids.bob, ids.bob);
        expect(res.status).toBe(400);
        expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('answers a body that is not JSON with 400, not 500', async () => {
        prisma.user.findUnique.mockResolvedValue({ id: ids.alice, name: 'Alice' });
        const res = await DELETE(
            new Request(`http://localhost/api/groups/${ids.group}/members`, { method: 'DELETE', body: '{not json' }),
            { params: Promise.resolve({ groupId: ids.group }) }
        );
        expect(res.status).toBe(400);
    });
});
