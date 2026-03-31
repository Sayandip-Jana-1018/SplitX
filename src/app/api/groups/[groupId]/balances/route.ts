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

// GET /api/groups/[groupId]/balances — compute balances for a specific group
export async function GET(
    _req: Request,
    { params }: { params: Promise<{ groupId: string }> }
) {
    try {
        const session = await auth();
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { groupId } = await params;
        const user = await prisma.user.findUnique({ where: { email: session.user.email } });

        if (!user) {
            return NextResponse.json({ error: 'User not found' }, { status: 404 });
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

        const trips = group.trips;

        if (trips.length === 0) {
            return NextResponse.json({ members: [], balances: {}, settlements: [] });
        }

        const tripIds = trips.map(t => t.id);

        // Get all transactions + splits
        const transactions = await prisma.transaction.findMany({
            where: { tripId: { in: tripIds }, deletedAt: null },
            include: {
                payer: { select: { id: true, name: true, image: true } },
                splits: {
                    include: { user: { select: { id: true, name: true, image: true } } },
                },
                trip: {
                    select: { id: true, title: true },
                },
            },
            orderBy: { createdAt: 'desc' },
        });

        // Account for recorded settlements
        const recorded = await prisma.settlement.findMany({
            where: {
                tripId: { in: tripIds },
                status: { in: ['completed', 'confirmed'] },
                deletedAt: null,
            },
            include: {
                from: { select: { id: true, name: true } },
                to: { select: { id: true, name: true } },
                trip: { select: { id: true, title: true } },
            },
        });

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
            tripTitle: transaction.trip.title,
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

        const settlementSnapshots: FinanceSettlementSnapshot[] = recorded.map((settlement) => ({
            id: settlement.id,
            tripId: settlement.tripId,
            tripTitle: settlement.trip.title,
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

        const balances = computeGroupBalances({
            memberIds: members.map((member) => member.id),
            transactions: transactionSnapshots,
            settlements: settlementSnapshots,
        });

        const settlements = simplifyGroupBalances({
            balances,
            members,
        });

        return NextResponse.json({
            members: members.map((member) => ({
                id: member.id,
                name: member.name,
                image: member.image,
                role: member.role,
                balance: balances[member.id] || 0,
            })),
            balances,
            settlements,
            transactions: transactions.slice(0, 20), // recent 20
            totalSpent: transactions.reduce((s, t) => s + t.amount, 0),
        });
    } catch (error) {
        console.error('Failed to compute group balances:', error);
        return NextResponse.json({ error: 'Failed to fetch balances' }, { status: 500 });
    }
}
