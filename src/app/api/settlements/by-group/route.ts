import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import {
    computeGroupBalances,
    FinanceMember,
    FinanceSettlementSnapshot,
    FinanceTransactionSnapshot,
    simplifyGroupBalances,
} from '@/lib/groupFinance';

function buildFinanceMembers(group: {
    owner: { id: string; name: string | null; image: string | null; upiId: string | null };
    members: {
        user: { id: string; name: string | null; image: string | null; upiId: string | null };
    }[];
}) {
    const memberMap = new Map<string, FinanceMember>();

    memberMap.set(group.owner.id, {
        id: group.owner.id,
        name: group.owner.name || 'Unknown',
        image: group.owner.image || null,
        upiId: group.owner.upiId || null,
    });

    for (const member of group.members) {
        memberMap.set(member.user.id, {
            id: member.user.id,
            name: member.user.name || 'Unknown',
            image: member.user.image || null,
            upiId: member.user.upiId || null,
        });
    }

    return Array.from(memberMap.values());
}

// GET /api/settlements/by-group â€” returns per-group settlement data in one call
export async function GET() {
    try {
        const session = await auth();
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const user = await prisma.user.findUnique({ where: { email: session.user.email } });
        if (!user) {
            return NextResponse.json({ groups: [], global: { computed: [], recorded: [] } });
        }

        const groups = await prisma.group.findMany({
            where: {
                deletedAt: null,
                OR: [
                    { ownerId: user.id },
                    { members: { some: { userId: user.id } } },
                ],
            },
            include: {
                owner: {
                    select: { id: true, name: true, image: true, upiId: true },
                },
                members: {
                    include: { user: { select: { id: true, name: true, image: true, upiId: true } } },
                },
                trips: {
                    where: { isActive: true },
                    take: 1,
                    select: { id: true },
                },
            },
        });

        const tripIdToGroup = new Map<string, (typeof groups)[number]>();
        const allTripIds: string[] = [];

        for (const group of groups) {
            const activeTrip = group.trips[0];
            if (!activeTrip) continue;
            tripIdToGroup.set(activeTrip.id, group);
            allTripIds.push(activeTrip.id);
        }

        if (allTripIds.length === 0) {
            return NextResponse.json({ groups: [], global: { computed: [], recorded: [] } });
        }

        const nameMap: Record<string, string> = {};
        const imageMap: Record<string, string | null> = {};
        const upiMap: Record<string, string | null> = {};

        for (const group of groups) {
            for (const member of buildFinanceMembers(group)) {
                nameMap[member.id] = member.name;
                imageMap[member.id] = member.image || null;
                upiMap[member.id] = member.upiId || null;
            }
        }

        const [allTransactions, allCompletedSettlements, allRecordedSettlements] = await Promise.all([
            prisma.transaction.findMany({
                where: { tripId: { in: allTripIds }, deletedAt: null },
                include: { splits: true },
            }),
            prisma.settlement.findMany({
                where: {
                    tripId: { in: allTripIds },
                    status: { in: ['completed', 'confirmed'] },
                    deletedAt: null,
                },
            }),
            prisma.settlement.findMany({
                where: { tripId: { in: allTripIds }, deletedAt: null },
                include: {
                    from: { select: { id: true, name: true, image: true } },
                    to: { select: { id: true, name: true, image: true } },
                },
                orderBy: { createdAt: 'desc' },
            }),
        ]);

        const txnsByTrip = new Map<string, typeof allTransactions>();
        for (const transaction of allTransactions) {
            const transactions = txnsByTrip.get(transaction.tripId) || [];
            transactions.push(transaction);
            txnsByTrip.set(transaction.tripId, transactions);
        }

        const settlementsByTrip = new Map<string, typeof allCompletedSettlements>();
        for (const settlement of allCompletedSettlements) {
            const settlements = settlementsByTrip.get(settlement.tripId) || [];
            settlements.push(settlement);
            settlementsByTrip.set(settlement.tripId, settlements);
        }

        const recordedByTrip = new Map<string, typeof allRecordedSettlements>();
        for (const settlement of allRecordedSettlements) {
            const recorded = recordedByTrip.get(settlement.tripId) || [];
            recorded.push(settlement);
            recordedByTrip.set(settlement.tripId, recorded);
        }

        const perGroupResults = allTripIds.flatMap((tripId) => {
            const group = tripIdToGroup.get(tripId);
            if (!group) return [];

            const members = buildFinanceMembers(group);
            const transactions = txnsByTrip.get(tripId) || [];
            const completedSettlements = settlementsByTrip.get(tripId) || [];
            const recordedSettlements = recordedByTrip.get(tripId) || [];

            const transactionSnapshots: FinanceTransactionSnapshot[] = transactions.map((transaction) => ({
                id: transaction.id,
                tripId: transaction.tripId,
                tripTitle: group.name,
                title: transaction.title,
                amount: transaction.amount,
                splitType: transaction.splitType,
                payerId: transaction.payerId,
                payerName: nameMap[transaction.payerId] || 'Unknown',
                createdAt: transaction.createdAt,
                updatedAt: transaction.updatedAt,
                deletedAt: transaction.deletedAt,
                splits: transaction.splits.map((split) => ({
                    userId: split.userId,
                    userName: nameMap[split.userId] || 'Unknown',
                    amount: split.amount,
                })),
            }));

            const settlementSnapshots: FinanceSettlementSnapshot[] = completedSettlements.map((settlement) => ({
                id: settlement.id,
                tripId: settlement.tripId,
                tripTitle: group.name,
                fromId: settlement.fromId,
                fromName: nameMap[settlement.fromId] || 'Unknown',
                toId: settlement.toId,
                toName: nameMap[settlement.toId] || 'Unknown',
                amount: settlement.amount,
                status: settlement.status,
                method: settlement.method,
                note: settlement.note,
                createdAt: settlement.createdAt,
                updatedAt: settlement.updatedAt,
                deletedAt: settlement.deletedAt,
            }));

            const balances = computeGroupBalances({
                memberIds: members.map((member) => member.id),
                transactions: transactionSnapshots,
                settlements: settlementSnapshots,
            });

            const computed = simplifyGroupBalances({
                balances,
                members,
            }).map((transfer) => ({
                ...transfer,
                tripId,
                groupId: group.id,
                groupName: group.name,
                groupEmoji: group.emoji,
                groupBreakdown: [
                    {
                        groupName: group.name,
                        groupEmoji: group.emoji,
                        amount: transfer.amount,
                    },
                ],
            }));

            return [{
                groupId: group.id,
                groupName: group.name,
                groupEmoji: group.emoji,
                tripId,
                members,
                computed,
                recorded: recordedSettlements.map((settlement) => ({
                    id: settlement.id,
                    fromId: settlement.fromId,
                    toId: settlement.toId,
                    amount: settlement.amount,
                    status: settlement.status,
                    method: settlement.method,
                    note: settlement.note,
                    from: settlement.from,
                    to: settlement.to,
                    createdAt: settlement.createdAt,
                })),
            }];
        });

        return NextResponse.json({
            groups: perGroupResults,
            global: {
                computed: perGroupResults.flatMap((group) => group.computed),
                recorded: allRecordedSettlements,
            },
        });
    } catch (error) {
        console.error('Settlements by-group error:', error);
        return NextResponse.json({ error: 'Failed to compute settlements' }, { status: 500 });
    }
}
