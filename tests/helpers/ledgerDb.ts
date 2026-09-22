import { vi } from 'vitest';

/**
 * A stand-in for the four Prisma queries lib/ledger.ts makes, built from a
 * short description of one group's money. Route tests put these on their
 * Prisma mock (and on the transaction client) so the real ledger runs.
 */

export interface LedgerFixture {
    groupId: string;
    name?: string;
    ownerId: string;
    /** Current members, the owner included. */
    memberIds: string[];
    names: Record<string, string>;
    /** Newest first is not required: the fake sorts them the way the query does. */
    trips: { id: string; isActive: boolean; day: number }[];
    transactions?: { id: string; tripId: string; payerId: string; amount: number; splits: [string, number][] }[];
    settlements?: { id: string; tripId: string; fromId: string; toId: string; amount: number; status: string }[];
}

const at = (day: number) => new Date(Date.UTC(2026, 8, day));

const userOf = (fixture: LedgerFixture, id: string) => ({
    id,
    name: fixture.names[id] ?? null,
    image: null,
    upiId: `${id}@upi`,
});

export function ledgerQueries(fixture: LedgerFixture) {
    const trips = fixture.trips
        .map((trip) => ({ id: trip.id, title: `Trip ${trip.id}`, isActive: trip.isActive, createdAt: at(trip.day) }))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const group = {
        id: fixture.groupId,
        name: fixture.name ?? 'Goa',
        emoji: '🏖️',
        ownerId: fixture.ownerId,
        inviteCode: 'old-invite-code',
        owner: userOf(fixture, fixture.ownerId),
        members: fixture.memberIds.map((userId) => ({
            userId,
            role: userId === fixture.ownerId ? 'admin' : 'member',
            user: userOf(fixture, userId),
        })),
        trips,
    };

    const tripIds = (where: { tripId?: { in?: string[] } }) => where.tripId?.in ?? [];

    return {
        group: {
            // A route's own lookup asks for IDs only; the ledger asks for everything.
            findMany: vi.fn(async (args: { select?: unknown } = {}) => (args.select ? [{ id: group.id }] : [group])),
        },
        transaction: {
            findMany: vi.fn(async ({ where }: { where: { tripId?: { in?: string[] } } }) => (fixture.transactions ?? [])
                .filter((txn) => tripIds(where).includes(txn.tripId))
                .map((txn, i) => ({
                    id: txn.id,
                    tripId: txn.tripId,
                    title: `Expense ${txn.id}`,
                    amount: txn.amount,
                    splitType: 'equal',
                    payerId: txn.payerId,
                    createdAt: at(1 + i),
                    updatedAt: at(1 + i),
                    deletedAt: null,
                    splits: txn.splits.map(([userId, amount]) => ({ userId, amount })),
                }))),
        },
        settlement: {
            findMany: vi.fn(async ({ where }: { where: { tripId?: { in?: string[] } } }) => (fixture.settlements ?? [])
                .filter((stl) => tripIds(where).includes(stl.tripId))
                .map((stl, i) => ({
                    ...stl,
                    method: 'upi',
                    note: null,
                    createdAt: at(10 + i),
                    updatedAt: at(10 + i),
                    deletedAt: null,
                    from: { id: stl.fromId, name: fixture.names[stl.fromId] ?? null, image: null },
                    to: { id: stl.toId, name: fixture.names[stl.toId] ?? null, image: null },
                }))),
        },
        user: {
            findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.map((id) => userOf(fixture, id))),
        },
    };
}

/** Makes `prisma.$transaction(fn)` run `fn` against `tx`, the way interactive transactions do. */
export function runTransactionsOn<T>(tx: T) {
    return vi.fn(async (fn: (client: T) => unknown) => fn(tx));
}
