import { describe, expect, it } from 'vitest';
import {
    balanceOf,
    isLedgerSettled,
    loadGroupLedgers,
    pendingSettlementsOf,
    planLedgerTransfers,
    settlementRoom,
} from '@/lib/ledger';

/*
 * The ledger against a stand-in for Prisma that answers the four queries it
 * makes. Group "Goa" has two trips; money moves on both, so any answer that
 * reads one trip only comes out wrong.
 */

const person = (id: string, name: string) => ({ id, name, image: null, upiId: `${id}@upi` });
const alice = person('u-alice', 'Alice');
const bob = person('u-bob', 'Bob');
const carol = person('u-carol', 'Carol');
const dave = person('u-dave', 'Dave'); // was in the group once; no longer a member

const at = (day: number) => new Date(Date.UTC(2026, 8, day));

type Txn = { id: string; tripId: string; payerId: string; amount: number; splits: [string, number][]; day: number };
type Stl = { id: string; tripId: string; fromId: string; toId: string; amount: number; status: string; day: number };

function fakeDb(options: {
    trips?: { id: string; title: string; isActive: boolean; day: number }[];
    transactions?: Txn[];
    settlements?: Stl[];
}) {
    const everyone = new Map([alice, bob, carol, dave].map((user) => [user.id, user]));
    const trips = (options.trips ?? [
        { id: 'trip-old', title: 'Goa, day 1', isActive: false, day: 1 },
        { id: 'trip-new', title: 'Goa, day 2', isActive: true, day: 2 },
    ]).map((trip) => ({ id: trip.id, title: trip.title, isActive: trip.isActive, createdAt: at(trip.day) }))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const group = {
        id: 'g-goa',
        name: 'Goa',
        emoji: '🏖️',
        ownerId: alice.id,
        inviteCode: 'invite-1',
        owner: alice,
        members: [alice, bob, carol].map((user, i) => ({ userId: user.id, role: i === 0 ? 'admin' : 'member', user })),
        trips,
    };

    const inTrips = (where: { tripId: { in: string[] } }) => (row: { tripId: string }) => where.tripId.in.includes(row.tripId);

    return {
        group: { findMany: async () => [group] },
        transaction: {
            findMany: async ({ where }: { where: { tripId: { in: string[] } } }) => (options.transactions ?? [])
                .filter(inTrips(where))
                .map((txn) => ({
                    id: txn.id,
                    tripId: txn.tripId,
                    title: `Expense ${txn.id}`,
                    amount: txn.amount,
                    splitType: 'equal',
                    payerId: txn.payerId,
                    createdAt: at(txn.day),
                    updatedAt: at(txn.day),
                    deletedAt: null,
                    splits: txn.splits.map(([userId, amount]) => ({ userId, amount })),
                })),
        },
        settlement: {
            findMany: async ({ where }: { where: { tripId: { in: string[] } } }) => (options.settlements ?? [])
                .filter(inTrips(where))
                .map((stl) => ({
                    ...stl,
                    method: 'upi',
                    note: null,
                    createdAt: at(stl.day),
                    updatedAt: at(stl.day),
                    deletedAt: null,
                    from: everyone.get(stl.fromId)!,
                    to: everyone.get(stl.toId)!,
                })),
        },
        user: {
            findMany: async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.map((id) => everyone.get(id)).filter(Boolean),
        },
    } as never;
}

// Alice pays ₹9 for three on the first trip; Bob pays ₹6 for two on the second.
const twoTrips: Txn[] = [
    { id: 't1', tripId: 'trip-old', payerId: alice.id, amount: 900, splits: [[alice.id, 300], [bob.id, 300], [carol.id, 300]], day: 1 },
    { id: 't2', tripId: 'trip-new', payerId: bob.id, amount: 600, splits: [[alice.id, 300], [bob.id, 300]], day: 2 },
];

async function ledgerOf(options: Parameters<typeof fakeDb>[0]) {
    const [ledger] = await loadGroupLedgers(['g-goa'], fakeDb(options));
    return ledger;
}

describe('loadGroupLedgers', () => {
    it('adds up every trip of the group, to the paisa', async () => {
        const ledger = await ledgerOf({ transactions: twoTrips });
        expect(ledger.balances).toEqual({ [alice.id]: 300, [bob.id]: 0, [carol.id]: -300 });
        expect(planLedgerTransfers(ledger)).toEqual([
            expect.objectContaining({ from: carol.id, to: alice.id, amount: 300, fromName: 'Carol', toName: 'Alice', toUpiId: 'u-alice@upi' }),
        ]);
    });

    it('counts completed settlements on any trip, and never pending or cancelled ones', async () => {
        const ledger = await ledgerOf({
            transactions: twoTrips,
            settlements: [
                { id: 's1', tripId: 'trip-new', fromId: carol.id, toId: alice.id, amount: 100, status: 'completed', day: 3 },
                { id: 's2', tripId: 'trip-old', fromId: carol.id, toId: alice.id, amount: 50, status: 'confirmed', day: 3 },
                { id: 's3', tripId: 'trip-old', fromId: carol.id, toId: alice.id, amount: 150, status: 'paid_pending', day: 4 },
                { id: 's4', tripId: 'trip-new', fromId: carol.id, toId: alice.id, amount: 150, status: 'cancelled', day: 4 },
            ],
        });
        expect(ledger.balances).toEqual({ [alice.id]: 150, [bob.id]: 0, [carol.id]: -150 });
        // Every settlement is listed, whatever its status, for the history screens.
        expect(ledger.settlements.map((settlement) => settlement.id).sort()).toEqual(['s1', 's2', 's3', 's4']);
    });

    it('keeps someone who left with money still open, under their own name', async () => {
        const ledger = await ledgerOf({
            transactions: [
                { id: 't1', tripId: 'trip-old', payerId: dave.id, amount: 600, splits: [[alice.id, 300], [dave.id, 300]], day: 1 },
            ],
        });
        expect(balanceOf(ledger, dave.id)).toBe(300);
        expect(ledger.people.get(dave.id)).toMatchObject({ name: 'Dave', isMember: false });
        expect(ledger.members.map((member) => member.id)).toEqual([alice.id, bob.id, carol.id]);
        expect(planLedgerTransfers(ledger)).toEqual([expect.objectContaining({ from: alice.id, to: dave.id, amount: 300, toName: 'Dave' })]);
    });

    it('puts new money on the newest active trip', async () => {
        const ledger = await ledgerOf({});
        expect(ledger.defaultTripId).toBe('trip-new');
    });

    it('falls back to the newest trip when none is active', async () => {
        const ledger = await ledgerOf({
            trips: [
                { id: 'trip-a', title: 'A', isActive: false, day: 1 },
                { id: 'trip-b', title: 'B', isActive: false, day: 5 },
            ],
        });
        expect(ledger.defaultTripId).toBe('trip-b');
    });

    it('asks for nothing when there are no groups', async () => {
        expect(await loadGroupLedgers([], fakeDb({}))).toEqual([]);
    });
});

describe('settlementRoom', () => {
    it('allows up to the smaller of what the payer owes and what the receiver is owed', async () => {
        const ledger = await ledgerOf({ transactions: twoTrips });
        expect(settlementRoom(ledger, carol.id, alice.id)).toEqual({ owes: 300, owed: 300, waitingOut: 0, waitingIn: 0, room: 300 });
        expect(settlementRoom(ledger, carol.id, bob.id).room).toBe(0);
        expect(settlementRoom(ledger, alice.id, carol.id).room).toBe(0);
    });

    it('subtracts payments already on their way, except the one being approved', async () => {
        const ledger = await ledgerOf({
            transactions: twoTrips,
            settlements: [{ id: 's-open', tripId: 'trip-old', fromId: carol.id, toId: alice.id, amount: 200, status: 'initiated', day: 3 }],
        });
        expect(settlementRoom(ledger, carol.id, alice.id)).toMatchObject({ waitingOut: 200, waitingIn: 200, room: 100 });
        expect(settlementRoom(ledger, carol.id, alice.id, 's-open').room).toBe(300);
        expect(pendingSettlementsOf(ledger, carol.id).map((settlement) => settlement.id)).toEqual(['s-open']);
        expect(pendingSettlementsOf(ledger, bob.id)).toEqual([]);
    });
});

describe('isLedgerSettled', () => {
    it('is true only with every balance at zero and nothing waiting', async () => {
        expect(isLedgerSettled(await ledgerOf({ transactions: twoTrips }))).toBe(false);

        const square = [
            ...twoTrips,
            { id: 't3', tripId: 'trip-new', payerId: carol.id, amount: 300, splits: [[alice.id, 300]] as [string, number][], day: 3 },
        ];
        expect(isLedgerSettled(await ledgerOf({ transactions: square }))).toBe(true);
        expect(isLedgerSettled(await ledgerOf({
            transactions: square,
            settlements: [{ id: 's1', tripId: 'trip-new', fromId: bob.id, toId: alice.id, amount: 10, status: 'pending', day: 4 }],
        }))).toBe(false);
    });
});
