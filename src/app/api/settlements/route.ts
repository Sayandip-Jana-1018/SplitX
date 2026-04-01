import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { z } from 'zod';
import { createAuditLog } from '@/lib/auditLog';
import { serializeSettlementAuditSnapshot } from '@/lib/auditPayloads';
import {
    computeGroupBalances,
    FinanceMember,
    FinanceSettlementSnapshot,
    FinanceTransactionSnapshot,
    simplifyGroupBalances,
} from '@/lib/groupFinance';

const SettleSchema = z.object({
    tripId: z.string().cuid(),
    toUserId: z.string().cuid(),
    amount: z.number().int().positive(),
    method: z.string().default('upi'),
    note: z.string().optional(),
});

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

// GET /api/settlements?tripId=xxx — get computed settlements for a trip (or ALL trips if omitted)
export async function GET(req: Request) {
    try {
        const session = await auth();
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(req.url);
        const tripId = searchParams.get('tripId');

        const user = await prisma.user.findUnique({ where: { email: session.user.email } });
        if (!user) return NextResponse.json({ computed: [], recorded: [], balances: {} });

        if (tripId) {
            const transactions = await prisma.transaction.findMany({
                where: { tripId, deletedAt: null },
                include: { splits: true },
            });

            const balances: Record<string, number> = {};
            for (const transaction of transactions) {
                balances[transaction.payerId] = (balances[transaction.payerId] || 0) + transaction.amount;
                for (const split of transaction.splits) {
                    balances[split.userId] = (balances[split.userId] || 0) - split.amount;
                }
            }

            const completedSettlements = await prisma.settlement.findMany({
                where: {
                    tripId,
                    status: { in: ['completed', 'confirmed'] },
                    deletedAt: null,
                },
            });

            for (const settlement of completedSettlements) {
                balances[settlement.fromId] = (balances[settlement.fromId] || 0) + settlement.amount;
                balances[settlement.toId] = (balances[settlement.toId] || 0) - settlement.amount;
            }

            const transfers: { from: string; to: string; amount: number }[] = [];
            const debtors: { id: string; amount: number }[] = [];
            const creditors: { id: string; amount: number }[] = [];

            for (const [userId, balance] of Object.entries(balances)) {
                if (balance < -1) debtors.push({ id: userId, amount: -balance });
                else if (balance > 1) creditors.push({ id: userId, amount: balance });
            }

            debtors.sort((a, b) => b.amount - a.amount);
            creditors.sort((a, b) => b.amount - a.amount);

            let i = 0, j = 0;
            while (i < debtors.length && j < creditors.length) {
                const transfer = Math.min(debtors[i].amount, creditors[j].amount);
                if (transfer > 0) {
                    transfers.push({ from: debtors[i].id, to: creditors[j].id, amount: transfer });
                }
                debtors[i].amount -= transfer;
                creditors[j].amount -= transfer;
                if (debtors[i].amount === 0) i++;
                if (creditors[j].amount === 0) j++;
            }

            const allUserIds = new Set<string>();
            for (const transfer of transfers) {
                allUserIds.add(transfer.from);
                allUserIds.add(transfer.to);
            }

            const users = allUserIds.size > 0
                ? await prisma.user.findMany({
                    where: { id: { in: Array.from(allUserIds) } },
                    select: { id: true, name: true, image: true, upiId: true },
                })
                : [];
            const nameMap = Object.fromEntries(users.map((entry) => [entry.id, entry.name || 'Unknown']));
            const imageMap = Object.fromEntries(users.map((entry) => [entry.id, entry.image || null]));
            const upiMap = Object.fromEntries(users.map((entry) => [entry.id, entry.upiId || null]));

            const recorded = await prisma.settlement.findMany({
                where: { tripId, deletedAt: null },
                include: {
                    from: { select: { id: true, name: true, image: true } },
                    to: { select: { id: true, name: true, image: true } },
                },
                orderBy: { createdAt: 'desc' },
            });

            return NextResponse.json({
                computed: transfers.map((transfer) => ({
                    ...transfer,
                    fromName: nameMap[transfer.from] || 'Unknown',
                    toName: nameMap[transfer.to] || 'Unknown',
                    fromImage: imageMap[transfer.from] || null,
                    toImage: imageMap[transfer.to] || null,
                    toUpiId: upiMap[transfer.to] || null,
                })),
                recorded,
                balances,
            });
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
                    select: { id: true },
                },
            },
        });

        const tripIdToGroup = new Map<string, (typeof groups)[number]>();
        const allTripIds: string[] = [];

        for (const group of groups) {
            for (const trip of group.trips) {
                tripIdToGroup.set(trip.id, group);
                allTripIds.push(trip.id);
            }
        }

        if (allTripIds.length === 0) {
            return NextResponse.json({ computed: [], recorded: [], balances: {} });
        }

        const [allTransactions, allCompletedSettlements, recorded] = await Promise.all([
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

        const transactionsByGroup = new Map<string, typeof allTransactions>();
        for (const transaction of allTransactions) {
            const group = tripIdToGroup.get(transaction.tripId);
            if (!group) continue;
            const transactions = transactionsByGroup.get(group.id) || [];
            transactions.push(transaction);
            transactionsByGroup.set(group.id, transactions);
        }

        const settlementsByGroup = new Map<string, typeof allCompletedSettlements>();
        for (const settlement of allCompletedSettlements) {
            const group = tripIdToGroup.get(settlement.tripId);
            if (!group) continue;
            const settlements = settlementsByGroup.get(group.id) || [];
            settlements.push(settlement);
            settlementsByGroup.set(group.id, settlements);
        }

        const balances: Record<string, number> = {};
        const computed: Array<{
            from: string;
            to: string;
            amount: number;
            fromName: string;
            toName: string;
            fromImage: string | null;
            toImage: string | null;
            toUpiId: string | null;
            groupId: string;
            groupName: string;
            groupEmoji: string;
            groupBreakdown: { groupName: string; groupEmoji: string; amount: number }[];
        }> = [];

        for (const group of groups) {
            const members = buildFinanceMembers(group);
            const transactions = transactionsByGroup.get(group.id) || [];
            const settlements = settlementsByGroup.get(group.id) || [];

            const transactionSnapshots: FinanceTransactionSnapshot[] = transactions.map((transaction) => ({
                id: transaction.id,
                tripId: transaction.tripId,
                tripTitle: group.name,
                title: transaction.title,
                amount: transaction.amount,
                splitType: transaction.splitType,
                payerId: transaction.payerId,
                payerName: members.find((member) => member.id === transaction.payerId)?.name || 'Unknown',
                createdAt: transaction.createdAt,
                updatedAt: transaction.updatedAt,
                deletedAt: transaction.deletedAt,
                splits: transaction.splits.map((split) => ({
                    userId: split.userId,
                    userName: members.find((member) => member.id === split.userId)?.name || 'Unknown',
                    amount: split.amount,
                })),
            }));

            const settlementSnapshots: FinanceSettlementSnapshot[] = settlements.map((settlement) => ({
                id: settlement.id,
                tripId: settlement.tripId,
                tripTitle: group.name,
                fromId: settlement.fromId,
                fromName: members.find((member) => member.id === settlement.fromId)?.name || 'Unknown',
                toId: settlement.toId,
                toName: members.find((member) => member.id === settlement.toId)?.name || 'Unknown',
                amount: settlement.amount,
                status: settlement.status,
                method: settlement.method,
                note: settlement.note,
                createdAt: settlement.createdAt,
                updatedAt: settlement.updatedAt,
                deletedAt: settlement.deletedAt,
            }));

            const groupBalances = computeGroupBalances({
                memberIds: members.map((member) => member.id),
                transactions: transactionSnapshots,
                settlements: settlementSnapshots,
            });

            for (const [memberId, amount] of Object.entries(groupBalances)) {
                balances[memberId] = (balances[memberId] || 0) + amount;
            }

            const groupTransfers = simplifyGroupBalances({
                balances: groupBalances,
                members,
            });

            for (const transfer of groupTransfers) {
                computed.push({
                    ...transfer,
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
                });
            }
        }

        return NextResponse.json({ computed, recorded, balances });
    } catch {
        return NextResponse.json({ error: 'Failed to compute settlements' }, { status: 500 });
    }
}

// POST /api/settlements — record a settlement payment (immediately completed)
export async function POST(req: Request) {
    try {
        const session = await auth();
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await req.json();
        const parsed = SettleSchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
        }

        const user = await prisma.user.findUnique({ where: { email: session.user.email } });
        if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

        // ── Security: Block self-settlement ──
        if (user.id === parsed.data.toUserId) {
            return NextResponse.json({ error: 'Cannot settle with yourself' }, { status: 400 });
        }

        // ── Security: Verify the trip exists and user is a member ──
        const trip = await prisma.trip.findUnique({
            where: { id: parsed.data.tripId },
            include: {
                group: {
                    include: { members: { select: { userId: true } } },
                },
            },
        });
        if (!trip) return NextResponse.json({ error: 'Trip not found' }, { status: 404 });

        const memberIds = [trip.group.ownerId, ...trip.group.members.map(m => m.userId)];
        if (!memberIds.includes(user.id)) {
            return NextResponse.json({ error: 'You are not a member of this group' }, { status: 403 });
        }
        if (!memberIds.includes(parsed.data.toUserId)) {
            return NextResponse.json({ error: 'Recipient is not a member of this group' }, { status: 403 });
        }

        // ── Security: Duplicate check (same pair, same trip, within 60s) ──
        const sixtySecondsAgo = new Date(Date.now() - 60_000);
        const duplicate = await prisma.settlement.findFirst({
            where: {
                tripId: parsed.data.tripId,
                fromId: user.id,
                toId: parsed.data.toUserId,
                amount: parsed.data.amount,
                status: { in: ['pending', 'initiated', 'completed'] },
                createdAt: { gte: sixtySecondsAgo },
                deletedAt: null,
            },
        });
        if (duplicate) {
            return NextResponse.json(
                { error: 'This settlement was already completed less than a minute ago.' },
                { status: 409 }
            );
        }

        // ── Security: Over-settlement guard ──
        // Use the user's NET BALANCE in the group (not pairwise debt) because
        // the settlement page uses greedy netting which may route all of a user's
        // debt through a single person (simplified transfers).
        // e.g., if you owe ₹339 to A and ₹83 to B, greedy netting may say
        //       "pay ₹422 to A" — so the max per-person limit = total net owed.
        try {
            const tripTxns = await prisma.transaction.findMany({
                where: { tripId: parsed.data.tripId, deletedAt: null },
                include: { splits: true },
            });
            const completedSetts = await prisma.settlement.findMany({
                where: {
                    tripId: parsed.data.tripId,
                    status: { in: ['completed', 'confirmed'] },
                    deletedAt: null,
                },
            });

            // Calculate net balance for the settling user
            // Positive = they are owed, Negative = they owe
            let userBalance = 0;
            for (const txn of tripTxns) {
                if (txn.payerId === user.id) {
                    userBalance += txn.amount; // they paid this much
                }
                const userSplit = txn.splits.find(s => s.userId === user.id);
                if (userSplit) {
                    userBalance -= userSplit.amount; // they owe this much
                }
            }
            // Account for completed settlements
            for (const s of completedSetts) {
                if (s.fromId === user.id) {
                    userBalance += s.amount; // paid off debt
                }
                if (s.toId === user.id) {
                    userBalance -= s.amount; // received payment
                }
            }

            // If balance >= 0, user doesn't owe anything
            if (userBalance >= 0) {
                return NextResponse.json(
                    { error: `You don't owe anything in this group.` },
                    { status: 400 }
                );
            }

            // User's total debt = abs(negative balance)
            const totalDebt = Math.abs(userBalance);

            // Allow small tolerance (₹1 = 100 paise) for rounding
            if (parsed.data.amount > totalDebt + 100) {
                const owedFormatted = `₹${(totalDebt / 100).toLocaleString('en-IN')}`;
                return NextResponse.json(
                    { error: `Settlement amount exceeds what you owe. Your net balance is ${owedFormatted} in this group.` },
                    { status: 400 }
                );
            }
        } catch {
            // If balance calculation fails, allow the settlement to proceed
            // (better to allow than block a legitimate payment)
        }

        // ── Create settlement ──
        // UPI payments start as 'pending' — the confirm route will mark them 'completed'
        // Cash/other payments are immediately completed
        const isUpi = parsed.data.method === 'upi';
        const settlement = await prisma.settlement.create({
            data: {
                tripId: parsed.data.tripId,
                fromId: user.id,
                toId: parsed.data.toUserId,
                amount: parsed.data.amount,
                method: parsed.data.method,
                note: parsed.data.note,
                status: isUpi ? 'pending' : 'completed',
            },
            include: {
                from: { select: { name: true } },
                to: { select: { name: true } },
                trip: { select: { id: true, title: true, groupId: true } },
            },
        });

        await createAuditLog({
            userId: user.id,
            action: 'create',
            entityType: 'settlement',
            entityId: settlement.id,
            details: {
                groupId: trip.group.id,
                tripId: trip.id,
                status: settlement.status,
                after: serializeSettlementAuditSnapshot({
                    id: settlement.id,
                    tripId: settlement.trip.id,
                    tripTitle: settlement.trip.title,
                    fromId: user.id,
                    fromName: settlement.from.name,
                    toId: parsed.data.toUserId,
                    toName: settlement.to.name,
                    amount: settlement.amount,
                    status: settlement.status,
                    method: settlement.method,
                    note: settlement.note,
                    createdAt: settlement.createdAt,
                    updatedAt: settlement.updatedAt,
                    deletedAt: settlement.deletedAt,
                }),
            },
        });

        // ── Notify + chat only for immediately-completed (non-UPI) settlements ──
        if (!isUpi) {
            await prisma.notification.create({
                data: {
                    user: { connect: { id: parsed.data.toUserId } },
                    actor: { connect: { id: user.id } },
                    type: 'settlement_completed',
                    title: '✅ Payment Received',
                    body: `${user.name || 'Someone'} paid you ₹${(parsed.data.amount / 100).toLocaleString('en-IN')} via ${parsed.data.method}`,
                    link: '/settlements',
                },
            });

            await prisma.groupMessage.create({
                data: {
                    groupId: trip.group.id,
                    senderId: user.id,
                    type: 'system',
                    content: `💸 ${settlement.from.name || 'Someone'} paid ₹${(parsed.data.amount / 100).toFixed(0)} to ${settlement.to.name || 'someone'} (${parsed.data.method})`,
                    settlementId: settlement.id,
                },
            });
        }

        return NextResponse.json(settlement, { status: 201 });
    } catch (error) {
        console.error('Settlement create error:', error);
        return NextResponse.json({ error: 'Failed to record settlement' }, { status: 500 });
    }
}
