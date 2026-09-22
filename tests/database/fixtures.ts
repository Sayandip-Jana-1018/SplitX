import { prisma } from '@/lib/db';

/** Empties every table the app writes to, keeping the migration records. */
export async function emptyDatabase() {
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
        SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map(({ tablename }) => `"${tablename}"`).join(', ')} CASCADE`);
}

let people = 0;

/** An account, as sign-up creates it. */
export function person(name: string) {
    people += 1;
    return prisma.user.create({ data: { name, email: `${name.toLowerCase()}.${people}@example.test` } });
}

/** A group owned by `owner` with `others` as members and one trip, as the app creates them. */
export async function groupOf(owner: { id: string }, others: { id: string }[]) {
    const group = await prisma.group.create({
        data: {
            name: 'Goa',
            ownerId: owner.id,
            members: { create: [{ userId: owner.id, role: 'admin' }, ...others.map((other) => ({ userId: other.id }))] },
            trips: { create: { title: 'Goa 2026' } },
        },
        include: { trips: true },
    });
    return { group, trip: group.trips[0] };
}

/** An expense `payer` paid, shared equally among `sharers` (paise, dividing evenly). */
export function expense(tripId: string, payer: { id: string }, amount: number, sharers: { id: string }[]) {
    return prisma.transaction.create({
        data: {
            tripId,
            payerId: payer.id,
            amount,
            title: 'Dinner',
            splitType: 'equal',
            splits: { create: sharers.map((sharer) => ({ userId: sharer.id, amount: amount / sharers.length })) },
        },
    });
}

/** What a session looks like to a route handler. */
export const sessionOf = (user: { email: string | null }) => ({ user: { email: user.email }, expires: '2099-01-01T00:00:00.000Z' });
