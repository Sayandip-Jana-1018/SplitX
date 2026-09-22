import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { loadGroupLedger } from '@/lib/ledger';
import { emptyDatabase, expense, groupOf, person, sessionOf } from './fixtures';

const { auth, removeAvatars } = vi.hoisted(() => ({ auth: vi.fn(), removeAvatars: vi.fn() }));
vi.mock('@/lib/auth', () => ({ auth }));
vi.mock('@/lib/storage', () => ({ removeAvatars }));

const me = await import('@/app/api/me/route');

beforeEach(async () => {
    await emptyDatabase();
    removeAvatars.mockResolvedValue(0);
});
afterAll(() => prisma.$disconnect());

const deleteAs = (user: { email: string | null }) => {
    auth.mockResolvedValue(sessionOf(user));
    return me.DELETE();
};

describe('deleting an account', () => {
    it('is refused while the person owes money, and changes nothing', async () => {
        const [alice, bob] = [await person('Alice'), await person('Bob')];
        const { group, trip } = await groupOf(alice, [bob]);
        await expense(trip.id, alice, 20_000, [alice, bob]);

        const res = await deleteAs(bob);

        expect(res.status).toBe(409);
        expect((await res.json()).error).toContain('you owe ₹100 in Goa');
        expect(await prisma.user.findUniqueOrThrow({ where: { id: bob.id } })).toMatchObject({ email: bob.email, name: 'Bob' });
        expect(await prisma.groupMember.count({ where: { groupId: group.id, userId: bob.id } })).toBe(1);
        expect(removeAvatars).not.toHaveBeenCalled();
    });

    it('once square, erases the person and keeps the group’s history whole', async () => {
        const [alice, bob] = [await person('Alice'), await person('Bob')];
        const { group, trip } = await groupOf(alice, [bob]);
        await expense(trip.id, alice, 20_000, [alice, bob]);
        await prisma.settlement.create({ data: { tripId: trip.id, fromId: bob.id, toId: alice.id, amount: 10_000, status: 'completed' } });
        await prisma.user.update({ where: { id: bob.id }, data: { password: 'hash', phone: '+91 90000 00000', upiId: 'bob@upi', image: 'https://photo' } });

        const res = await deleteAs(bob);

        expect(res.status).toBe(200);
        const erased = await prisma.user.findUniqueOrThrow({ where: { id: bob.id } });
        expect(erased).toMatchObject({ name: 'Deleted user', email: null, password: null, phone: null, upiId: null, image: null, tokenVersion: 1 });
        expect(await prisma.groupMember.count({ where: { userId: bob.id } })).toBe(0);

        // The history is still there, still adds up, and names him as he now is.
        expect(await prisma.splitItem.count({ where: { userId: bob.id } })).toBe(1);
        const ledger = (await loadGroupLedger(group.id))!;
        expect(Object.values(ledger.balances).every((balance) => balance === 0)).toBe(true);
        expect(ledger.people.get(bob.id)).toMatchObject({ name: 'Deleted user', isMember: false });
        expect((await prisma.group.findUniqueOrThrow({ where: { id: group.id } })).deletedAt).toBeNull();
        expect(removeAvatars).toHaveBeenCalledWith(bob.id, 'receipts');
    });

    it('hands a group it owns to the longest-standing member, and closes one nobody else is in', async () => {
        const [alice, bob, carol] = [await person('Alice'), await person('Bob'), await person('Carol')];
        const shared = await groupOf(alice, []);
        await prisma.groupMember.create({ data: { groupId: shared.group.id, userId: carol.id, joinedAt: new Date('2026-01-01') } });
        await prisma.groupMember.create({ data: { groupId: shared.group.id, userId: bob.id, joinedAt: new Date('2026-02-01') } });
        const alone = await groupOf(alice, []);

        expect((await deleteAs(alice)).status).toBe(200);

        expect((await prisma.group.findUniqueOrThrow({ where: { id: shared.group.id } })).ownerId).toBe(carol.id);
        expect((await prisma.groupMember.findFirstOrThrow({ where: { groupId: shared.group.id, userId: carol.id } })).role).toBe('admin');
        expect((await prisma.group.findUniqueOrThrow({ where: { id: alone.group.id } })).deletedAt).not.toBeNull();
    });

    it('frees the address: the same email can sign up again as a new account', async () => {
        const alice = await person('Alice');
        const email = alice.email!;
        expect((await deleteAs(alice)).status).toBe(200);

        const again = await prisma.user.create({ data: { name: 'Alice', email } });
        expect(again.id).not.toBe(alice.id);
    });
});
