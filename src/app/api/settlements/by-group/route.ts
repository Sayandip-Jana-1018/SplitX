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

// GET /api/settlements/by-group — returns per-group settlement data in one call
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

        // 1) Get all groups the user belongs to, with members + active trip
        const groups = await prisma.group.findMany({
            where: {
                deletedAt: null,
                OR: [
                    { ownerId: user.id },
                    { members: { some: { userId: user.id } } },
                ],
            },
            include: {
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

        // Build global name/image/upi maps
        const nameMap: Record<string, string> = {};
        const imageMap: Record<string, string | null> = {};
        const upiMap: Record<string, string | null> = {};

        for (const g of groups) {
            // Include owner
            nameMap[g.ownerId] = nameMap[g.ownerId] || 'Unknown';
            for (const m of g.members) {
                nameMap[m.user.id] = m.user.name || 'Unknown';
                imageMap[m.user.id] = m.user.image || null;
                upiMap[m.user.id] = m.user.upiId || null;
            }
        }

        // 2) Collect all active tripIds
        const tripIdToGroup = new Map<string, typeof groups[0]>();
        const allTripIds: string[] = [];

        for (const g of groups) {
            if (g.trips[0]) {
                tripIdToGroup.set(g.trips[0].id, g);
                allTripIds.push(g.trips[0].id);
            }
        }

        if (allTripIds.length === 0) {
            return NextResponse.json({ groups: [], global: { computed: [], recorded: [] } });
        }

        // 3) Batch-fetch ALL transactions + splits across all trips
        const allTransactions = await prisma.transaction.findMany({
            where: { tripId: { in: allTripIds }, deletedAt: null },
            include: { splits: true },
        });

        // 4) Batch-fetch ALL completed settlements
        const allCompletedSettlements = await prisma.settlement.findMany({
            where: {
                tripId: { in: allTripIds },
                status: { in: ['completed', 'confirmed'] },
                deletedAt: null,
            },
        });

        // 5) Batch-fetch ALL recorded settlements (for the list)
        const allRecordedSettlements = await prisma.settlement.findMany({
            where: { tripId: { in: allTripIds }, deletedAt: null },
            include: {
                from: { select: { id: true, name: true, image: true } },
                to: { select: { id: true, name: true, image: true } },
            },
            orderBy: { createdAt: 'desc' },
        });

        // 6) Group transactions and settlements by tripId
        const txnsByTrip = new Map<string, typeof allTransactions>();
        for (const txn of allTransactions) {
            const arr = txnsByTrip.get(txn.tripId) || [];
            arr.push(txn);
            txnsByTrip.set(txn.tripId, arr);
        }

        const settByTrip = new Map<string, typeof allCompletedSettlements>();
        for (const s of allCompletedSettlements) {
            const arr = settByTrip.get(s.tripId) || [];
            arr.push(s);
            settByTrip.set(s.tripId, arr);
        }

        const recordedByTrip = new Map<string, typeof allRecordedSettlements>();
        for (const r of allRecordedSettlements) {
            const arr = recordedByTrip.get(r.tripId) || [];
            arr.push(r);
            recordedByTrip.set(r.tripId, arr);
        }

        // 7) For each group, compute per-group settlements using greedy netting
        const perGroupResults = [];

        for (const tripId of allTripIds) {
            const group = tripIdToGroup.get(tripId);
            if (!group) continue;

            const transactions = txnsByTrip.get(tripId) || [];
            const completedSettlements = settByTrip.get(tripId) || [];
            const recorded = recordedByTrip.get(tripId) || [];

            const members: FinanceMember[] = group.members.map((member) => ({
                id: member.user.id,
                name: member.user.name || 'Unknown',
                image: member.user.image || null,
                upiId: member.user.upiId || null,
            }));

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

            const computedWithNames = simplifyGroupBalances({
                balances,
                members,
            });

            perGroupResults.push({
                groupId: group.id,
                groupName: group.name,
                groupEmoji: group.emoji,
                tripId,
                members,
                computed: computedWithNames,
                recorded: recorded.map(r => ({
                    id: r.id,
                    fromId: r.fromId,
                    toId: r.toId,
                    amount: r.amount,
                    status: r.status,
                    method: r.method,
                    note: r.note,
                    from: r.from,
                    to: r.to,
                    createdAt: r.createdAt,
                })),
            });
        }

        // 8) Compute global pairwise debts WITH per-group breakdown
        const pairwise = new Map<string, number>();
        // Track pairwise debts per-group for breakdown transparency
        const pairwiseByGroup = new Map<string, Map<string, { amount: number; groupName: string; groupEmoji: string }>>();
        const addDebt = (fromId: string, toId: string, amount: number) => {
            if (fromId === toId) return;
            const key = fromId < toId ? `${fromId}:${toId}` : `${toId}:${fromId}`;
            const sign = fromId < toId ? 1 : -1;
            pairwise.set(key, (pairwise.get(key) || 0) + amount * sign);
        };
        const addDebtForGroup = (fromId: string, toId: string, amount: number, groupName: string, groupEmoji: string, tripId: string) => {
            if (fromId === toId) return;
            const key = fromId < toId ? `${fromId}:${toId}` : `${toId}:${fromId}`;
            const sign = fromId < toId ? 1 : -1;
            if (!pairwiseByGroup.has(key)) pairwiseByGroup.set(key, new Map());
            const groupMap = pairwiseByGroup.get(key)!;
            const existing = groupMap.get(tripId) || { amount: 0, groupName, groupEmoji };
            existing.amount += amount * sign;
            groupMap.set(tripId, existing);
        };

        for (const txn of allTransactions) {
            const group = tripIdToGroup.get(txn.tripId);
            for (const split of txn.splits) {
                addDebt(split.userId, txn.payerId, split.amount);
                if (group) {
                    addDebtForGroup(split.userId, txn.payerId, split.amount, group.name, group.emoji, txn.tripId);
                }
            }
        }
        for (const s of allCompletedSettlements) {
            const group = tripIdToGroup.get(s.tripId);
            addDebt(s.fromId, s.toId, -s.amount);
            if (group) {
                addDebtForGroup(s.fromId, s.toId, -s.amount, group.name, group.emoji, s.tripId);
            }
        }

        const globalTransfers: {
            from: string; to: string; amount: number;
            fromName: string; toName: string;
            fromImage: string | null; toImage: string | null;
            toUpiId: string | null;
            groupBreakdown: { groupName: string; groupEmoji: string; amount: number }[];
        }[] = [];

        for (const [key, amount] of pairwise.entries()) {
            if (Math.abs(amount) < 1) continue;
            const [userA, userB] = key.split(':');

            // Build per-group breakdown for this pair
            const groupMap = pairwiseByGroup.get(key);
            const breakdown: { groupName: string; groupEmoji: string; amount: number }[] = [];
            if (groupMap) {
                for (const [, entry] of groupMap.entries()) {
                    if (Math.abs(entry.amount) < 1) continue;
                    // Align the amount direction: positive = userA owes userB
                    breakdown.push({
                        groupName: entry.groupName,
                        groupEmoji: entry.groupEmoji,
                        amount: entry.amount,
                    });
                }
                // Sort by absolute amount descending for readability
                breakdown.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
            }

            if (amount > 0) {
                // userA owes userB
                globalTransfers.push({
                    from: userA, to: userB, amount,
                    fromName: nameMap[userA] || 'Unknown', toName: nameMap[userB] || 'Unknown',
                    fromImage: imageMap[userA] || null, toImage: imageMap[userB] || null,
                    toUpiId: upiMap[userB] || null,
                    groupBreakdown: breakdown.map(b => ({
                        ...b,
                        // If net positive, the debt flows userA→userB, so show positive
                        amount: b.amount,
                    })),
                });
            } else {
                // userB owes userA
                globalTransfers.push({
                    from: userB, to: userA, amount: -amount,
                    fromName: nameMap[userB] || 'Unknown', toName: nameMap[userA] || 'Unknown',
                    fromImage: imageMap[userB] || null, toImage: imageMap[userA] || null,
                    toUpiId: upiMap[userA] || null,
                    groupBreakdown: breakdown.map(b => ({
                        ...b,
                        // Flip direction: debt flows userB→userA
                        amount: -b.amount,
                    })),
                });
            }
        }

        return NextResponse.json({
            groups: perGroupResults,
            global: {
                computed: globalTransfers,
                recorded: allRecordedSettlements,
            },
        });
    } catch (error) {
        console.error('Settlements by-group error:', error);
        return NextResponse.json({ error: 'Failed to compute settlements' }, { status: 500 });
    }
}

