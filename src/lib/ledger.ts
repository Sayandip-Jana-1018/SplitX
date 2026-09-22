import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import {
    computeGroupBalances,
    type FinanceMember,
    type FinanceSettlementSnapshot,
    type FinanceTransactionSnapshot,
    type SimplifiedTransfer,
    simplifyGroupBalances,
} from '@/lib/groupFinance';
import { isCompletedSettlementStatus, isPendingSettlementStatus } from '@/lib/settlementStatus';

/**
 * A group's money, decided in one place.
 *
 * A group's balances are every live expense and every completed settlement
 * across ALL of its trips. Settle Up used to read one arbitrary trip per group,
 * so its suggestions disagreed with the group page. Everything that shows or
 * checks a balance now loads it from here.
 *
 * Nobody is left out: someone who has left the group but is still owed money,
 * or still owes it, stays in the balances and in the settle-up plan under their
 * name. The old planner kept only current members, so such debts vanished.
 */

type Db = Prisma.TransactionClient;

export interface LedgerPerson extends FinanceMember {
    /** False for someone who appears in the group's history but has left it. */
    isMember: boolean;
}

export interface LedgerSettlement {
    id: string;
    tripId: string;
    fromId: string;
    toId: string;
    amount: number;
    status: string;
    method: string | null;
    note: string | null;
    createdAt: Date;
    updatedAt: Date;
    from: { id: string; name: string | null; image: string | null };
    to: { id: string; name: string | null; image: string | null };
}

export interface GroupLedger {
    groupId: string;
    groupName: string;
    groupEmoji: string;
    ownerId: string;
    inviteCode: string;
    /** Current members, the owner included. */
    members: FinanceMember[];
    /** Everyone the ledger mentions: current members and anyone who has left. */
    people: Map<string, LedgerPerson>;
    trips: { id: string; title: string; isActive: boolean; createdAt: Date }[];
    /** Where new expenses and settlements go: the newest active trip, else the newest trip. */
    defaultTripId: string | null;
    transactions: FinanceTransactionSnapshot[];
    /** Every settlement that isn't deleted, newest first, in any status. */
    settlements: LedgerSettlement[];
    /** Exact paise per person. Positive is owed money; negative owes it. */
    balances: Record<string, number>;
}

const userFields = { id: true, name: true, image: true, upiId: true } as const;

/** Loads the ledgers of several groups in a fixed number of queries. */
export async function loadGroupLedgers(groupIds: readonly string[], db: Db = prisma): Promise<GroupLedger[]> {
    if (groupIds.length === 0) return [];

    const groups = await db.group.findMany({
        where: { id: { in: [...groupIds] }, deletedAt: null },
        include: {
            owner: { select: userFields },
            members: { include: { user: { select: userFields } }, orderBy: { joinedAt: 'asc' } },
            trips: { select: { id: true, title: true, isActive: true, createdAt: true }, orderBy: { createdAt: 'desc' } },
        },
    });

    const tripIds = groups.flatMap((group) => group.trips.map((trip) => trip.id));
    const [transactions, settlements] = tripIds.length === 0
        ? [[], []]
        : await Promise.all([
            db.transaction.findMany({
                where: { tripId: { in: tripIds }, deletedAt: null },
                include: { splits: true },
                orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            }),
            db.settlement.findMany({
                where: { tripId: { in: tripIds }, deletedAt: null },
                include: {
                    from: { select: { id: true, name: true, image: true } },
                    to: { select: { id: true, name: true, image: true } },
                },
                orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            }),
        ]);

    // Names for anyone the history mentions who is no longer a member.
    const memberIds = new Set(groups.flatMap((group) => [group.owner.id, ...group.members.map((member) => member.user.id)]));
    const mentioned = new Set<string>();
    for (const transaction of transactions) {
        mentioned.add(transaction.payerId);
        for (const split of transaction.splits) mentioned.add(split.userId);
    }
    for (const settlement of settlements) {
        mentioned.add(settlement.fromId);
        mentioned.add(settlement.toId);
    }
    const formerIds = [...mentioned].filter((userId) => !memberIds.has(userId));
    const formerUsers = formerIds.length === 0
        ? []
        : await db.user.findMany({ where: { id: { in: formerIds } }, select: userFields });
    const formerById = new Map(formerUsers.map((user) => [user.id, user]));

    const tripToGroup = new Map<string, string>();
    for (const group of groups) for (const trip of group.trips) tripToGroup.set(trip.id, group.id);

    return groups.map((group) => {
        const people = new Map<string, LedgerPerson>();
        const addMember = (user: { id: string; name: string | null; image: string | null; upiId: string | null }, role?: string) => {
            people.set(user.id, {
                id: user.id,
                name: user.name || 'Unknown',
                image: user.image || null,
                upiId: user.upiId || null,
                role,
                isMember: true,
            });
        };
        addMember(group.owner, 'admin');
        for (const member of group.members) addMember(member.user, member.role);
        const members: FinanceMember[] = [...people.values()].map((person) => ({
            id: person.id,
            name: person.name,
            image: person.image,
            upiId: person.upiId,
            role: person.role,
        }));

        const tripTitles = new Map(group.trips.map((trip) => [trip.id, trip.title]));
        const groupTransactions = transactions.filter((transaction) => tripToGroup.get(transaction.tripId) === group.id);
        const groupSettlements = settlements.filter((settlement) => tripToGroup.get(settlement.tripId) === group.id);

        const nameOf = (userId: string) => {
            const known = people.get(userId);
            if (known) return known.name;
            const former = formerById.get(userId);
            if (!former) return 'Unknown';
            people.set(userId, {
                id: former.id,
                name: former.name || 'Former member',
                image: former.image || null,
                upiId: former.upiId || null,
                isMember: false,
            });
            return people.get(userId)!.name;
        };

        const transactionSnapshots: FinanceTransactionSnapshot[] = groupTransactions.map((transaction) => ({
            id: transaction.id,
            tripId: transaction.tripId,
            tripTitle: tripTitles.get(transaction.tripId) || group.name,
            title: transaction.title,
            amount: transaction.amount,
            splitType: transaction.splitType,
            payerId: transaction.payerId,
            payerName: nameOf(transaction.payerId),
            createdAt: transaction.createdAt,
            updatedAt: transaction.updatedAt,
            deletedAt: transaction.deletedAt,
            splits: transaction.splits.map((split) => ({
                userId: split.userId,
                userName: nameOf(split.userId),
                amount: split.amount,
            })),
        }));

        const settlementSnapshots: FinanceSettlementSnapshot[] = groupSettlements
            .filter((settlement) => isCompletedSettlementStatus(settlement.status))
            .map((settlement) => ({
                id: settlement.id,
                tripId: settlement.tripId,
                tripTitle: tripTitles.get(settlement.tripId) || group.name,
                fromId: settlement.fromId,
                fromName: nameOf(settlement.fromId),
                toId: settlement.toId,
                toName: nameOf(settlement.toId),
                amount: settlement.amount,
                status: settlement.status,
                method: settlement.method,
                note: settlement.note,
                createdAt: settlement.createdAt,
                updatedAt: settlement.updatedAt,
                deletedAt: settlement.deletedAt,
            }));
        // Make sure everyone a pending settlement names is known too.
        for (const settlement of groupSettlements) {
            nameOf(settlement.fromId);
            nameOf(settlement.toId);
        }

        const balances = computeGroupBalances({
            memberIds: members.map((member) => member.id),
            transactions: transactionSnapshots,
            settlements: settlementSnapshots,
        });

        const activeTrip = group.trips.find((trip) => trip.isActive) ?? group.trips[0] ?? null;

        return {
            groupId: group.id,
            groupName: group.name,
            groupEmoji: group.emoji,
            ownerId: group.ownerId,
            inviteCode: group.inviteCode,
            members,
            people,
            trips: group.trips,
            defaultTripId: activeTrip?.id ?? null,
            transactions: transactionSnapshots,
            settlements: groupSettlements.map((settlement) => ({
                id: settlement.id,
                tripId: settlement.tripId,
                fromId: settlement.fromId,
                toId: settlement.toId,
                amount: settlement.amount,
                status: settlement.status,
                method: settlement.method,
                note: settlement.note,
                createdAt: settlement.createdAt,
                updatedAt: settlement.updatedAt,
                from: settlement.from,
                to: settlement.to,
            })),
            balances,
        };
    });
}

/** Loads one group's ledger, or null if the group doesn't exist or is deleted. */
export async function loadGroupLedger(groupId: string, db: Db = prisma): Promise<GroupLedger | null> {
    const [ledger] = await loadGroupLedgers([groupId], db);
    return ledger ?? null;
}

/** The fewest payments that settle the group, exact to the paisa, including anyone who has left. */
export function planLedgerTransfers(ledger: GroupLedger): SimplifiedTransfer[] {
    return simplifyGroupBalances({ balances: ledger.balances, people: [...ledger.people.values()] });
}

/** What a person is owed (positive) or owes (negative) in this group, in paise. */
export function balanceOf(ledger: GroupLedger, userId: string): number {
    return ledger.balances[userId] ?? 0;
}

/** Settlements involving this person that are still waiting to be paid or approved. */
export function pendingSettlementsOf(ledger: GroupLedger, userId: string): LedgerSettlement[] {
    return ledger.settlements.filter(
        (settlement) => isPendingSettlementStatus(settlement.status) && (settlement.fromId === userId || settlement.toId === userId)
    );
}

export interface SettlementRoom {
    /** What the payer owes the group, in paise (0 if they owe nothing). */
    owes: number;
    /** What the receiver is owed by the group, in paise (0 if nothing). */
    owed: number;
    /** Paise the payer already has on the way in settlements still open. */
    waitingOut: number;
    /** Paise already on the way to the receiver in settlements still open. */
    waitingIn: number;
    /** The most a new payment from payer to receiver can be. */
    room: number;
}

/**
 * How much one person can still pay another in this group without anyone
 * ending up overpaid: no more than the payer owes and no more than the
 * receiver is owed, less what open settlements already carry. Every payment in
 * the settle-up plan fits, because the plan only moves money from people who
 * owe to people who are owed. `exceptSettlementId` leaves one open settlement
 * out of the sums: the one being approved.
 */
export function settlementRoom(
    ledger: GroupLedger,
    fromId: string,
    toId: string,
    exceptSettlementId?: string
): SettlementRoom {
    const owes = Math.max(0, -balanceOf(ledger, fromId));
    const owed = Math.max(0, balanceOf(ledger, toId));
    let waitingOut = 0;
    let waitingIn = 0;
    for (const settlement of ledger.settlements) {
        if (settlement.id === exceptSettlementId || !isPendingSettlementStatus(settlement.status)) continue;
        if (settlement.fromId === fromId) waitingOut += settlement.amount;
        if (settlement.toId === toId) waitingIn += settlement.amount;
    }
    const room = Math.max(0, Math.min(owes - waitingOut, owed - waitingIn));
    return { owes, owed, waitingOut, waitingIn, room };
}

/** True when nobody in the group owes anything and no settlement is still open. */
export function isLedgerSettled(ledger: GroupLedger): boolean {
    return Object.values(ledger.balances).every((amount) => amount === 0)
        && !ledger.settlements.some((settlement) => isPendingSettlementStatus(settlement.status));
}
