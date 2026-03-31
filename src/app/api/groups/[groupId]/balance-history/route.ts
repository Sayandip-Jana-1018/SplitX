import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { isFeatureEnabled } from '@/lib/featureFlags';
import {
    buildBalanceHistory,
    BalanceHistoryDateRange,
    BalanceHistoryFilterKey,
    FinanceMember,
    FinanceSettlementSnapshot,
    FinanceTransactionSnapshot,
    simplifyGroupBalances,
    computeGroupBalances,
} from '@/lib/groupFinance';

export async function GET(
    req: Request,
    { params }: { params: Promise<{ groupId: string }> }
) {
    try {
        if (!isFeatureEnabled('balanceJourney')) {
            return NextResponse.json({ error: 'Balance journey is disabled' }, { status: 404 });
        }

        const session = await auth();
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { groupId } = await params;
        const { searchParams } = new URL(req.url);
        const requestedUserId = searchParams.get('userId');
        const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '120', 10) || 120, 1), 250);
        const beforeCreatedAt = searchParams.get('beforeCreatedAt');
        const beforeId = searchParams.get('beforeId');
        const filterKey = parseFilterKey(searchParams.get('filterKey'));
        const dateRange = parseDateRange(searchParams.get('dateRange'));

        const user = await prisma.user.findUnique({ where: { email: session.user.email } });
        if (!user) {
            return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }

        const effectiveUserId = requestedUserId || user.id;
        if (effectiveUserId !== user.id) {
            return NextResponse.json({ error: 'You can only view your own balance journey' }, { status: 403 });
        }

        const group = await prisma.group.findFirst({
            where: {
                id: groupId,
                deletedAt: null,
                OR: [
                    { ownerId: user.id },
                    { members: { some: { userId: user.id } } },
                ],
            },
            include: {
                members: {
                    include: {
                        user: { select: { id: true, name: true, image: true, upiId: true } },
                    },
                },
                trips: {
                    select: { id: true, title: true },
                },
            },
        });

        if (!group) {
            return NextResponse.json({ error: 'Group not found or access denied' }, { status: 404 });
        }

        const tripIds = group.trips.map((trip) => trip.id);
        const tripTitleMap = new Map(group.trips.map((trip) => [trip.id, trip.title]));

        const [transactions, settlements, auditLogs] = await Promise.all([
            prisma.transaction.findMany({
                where: { tripId: { in: tripIds } },
                include: {
                    payer: { select: { id: true, name: true } },
                    splits: { include: { user: { select: { id: true, name: true } } } },
                },
                orderBy: { createdAt: 'asc' },
            }),
            prisma.settlement.findMany({
                where: {
                    tripId: { in: tripIds },
                    deletedAt: null,
                },
                include: {
                    from: { select: { id: true, name: true } },
                    to: { select: { id: true, name: true } },
                },
                orderBy: { updatedAt: 'asc' },
            }),
            prisma.auditLog.findMany({
                where: {
                    entityType: 'transaction',
                    createdAt: { gte: group.createdAt },
                },
                orderBy: { createdAt: 'asc' },
            }),
        ]);

        const members: FinanceMember[] = group.members.map((member) => ({
            id: member.user.id,
            name: member.user.name || 'Unknown',
            image: member.user.image || null,
            upiId: member.user.upiId || null,
            role: member.role,
        }));

        const transactionSnapshots: FinanceTransactionSnapshot[] = transactions.map((transaction) => ({
            id: transaction.id,
            tripId: transaction.tripId,
            tripTitle: tripTitleMap.get(transaction.tripId) || 'Trip',
            title: transaction.title,
            amount: transaction.amount,
            splitType: transaction.splitType,
            payerId: transaction.payerId,
            payerName: transaction.payer.name || 'Unknown',
            createdAt: transaction.createdAt,
            updatedAt: transaction.updatedAt,
            deletedAt: transaction.deletedAt,
            splits: transaction.splits.map((split) => ({
                userId: split.userId,
                userName: split.user.name || 'Unknown',
                amount: split.amount,
            })),
        }));

        const settlementSnapshots: FinanceSettlementSnapshot[] = settlements.map((settlement) => ({
            id: settlement.id,
            tripId: settlement.tripId,
            tripTitle: tripTitleMap.get(settlement.tripId) || 'Trip',
            fromId: settlement.fromId,
            fromName: settlement.from.name || 'Unknown',
            toId: settlement.toId,
            toName: settlement.to.name || 'Unknown',
            amount: settlement.amount,
            status: settlement.status,
            method: settlement.method,
            note: settlement.note,
            createdAt: settlement.createdAt,
            updatedAt: settlement.updatedAt,
            deletedAt: settlement.deletedAt,
        }));

        const scopedAuditLogs = auditLogs.filter((log) => {
            const details = log.details;
            if (!details || typeof details !== 'object' || Array.isArray(details)) {
                return false;
            }
            return (details as Record<string, unknown>).groupId === groupId;
        });

        const history = buildBalanceHistory({
            userId: effectiveUserId,
            members,
            transactions: transactionSnapshots,
            settlements: settlementSnapshots,
            auditLogs: scopedAuditLogs,
            limit,
            beforeCreatedAt,
            beforeId,
            filterKey,
            dateRange,
        });

        const currentBalances = computeGroupBalances({
            memberIds: members.map((member) => member.id),
            transactions: transactionSnapshots.filter((transaction) => !transaction.deletedAt),
            settlements: settlementSnapshots,
        });
        const simplified = simplifyGroupBalances({ balances: currentBalances, members });

        return NextResponse.json({
            group: {
                id: group.id,
                name: group.name,
                emoji: group.emoji,
            },
            user: {
                id: user.id,
                name: user.name || 'You',
            },
            currentBalance: history.currentBalance,
            currentRouteSummary: history.currentRouteSummary,
            changeCountThisWeek: history.changeCountThisWeek,
            currentSettlements: simplified.filter(
                (settlement) => settlement.from === effectiveUserId || settlement.to === effectiveUserId
            ),
            entries: history.entries,
            hasMore: history.hasMore,
            nextCursor: history.nextCursor,
        });
    } catch (error) {
        console.error('Balance history error:', error);
        return NextResponse.json({ error: 'Failed to fetch balance history' }, { status: 500 });
    }
}

function parseFilterKey(value: string | null): BalanceHistoryFilterKey {
    switch (value) {
        case 'expenses':
        case 'settlements':
        case 'edits':
            return value;
        default:
            return 'all';
    }
}

function parseDateRange(value: string | null): BalanceHistoryDateRange {
    switch (value) {
        case '7d':
        case '30d':
            return value;
        default:
            return 'all';
    }
}
