import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';

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

        // Get all trips for this group
        const trips = await prisma.trip.findMany({
            where: { groupId },
            select: { id: true },
        });

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
            },
            orderBy: { createdAt: 'desc' },
        });

        // Get group members
        const members = await prisma.groupMember.findMany({
            where: { groupId },
            include: { user: { select: { id: true, name: true, image: true } } },
        });

        // Calculate net balances
        const balances: Record<string, number> = {};
        for (const txn of transactions) {
            balances[txn.payerId] = (balances[txn.payerId] || 0) + txn.amount;
            for (const split of txn.splits) {
                balances[split.userId] = (balances[split.userId] || 0) - split.amount;
            }
        }

        // Account for recorded settlements
        const recorded = await prisma.settlement.findMany({
            where: {
                tripId: { in: tripIds },
                status: { in: ['completed', 'confirmed'] },
                deletedAt: null,
            },
        });

        for (const s of recorded) {
            balances[s.fromId] = (balances[s.fromId] || 0) + s.amount;
            balances[s.toId] = (balances[s.toId] || 0) - s.amount;
        }

        // Greedy netting to compute optimal settlements
        const debtors: { id: string; name: string; amount: number }[] = [];
        const creditors: { id: string; name: string; amount: number }[] = [];
        const memberMap = new Map(members.map(m => [m.user.id, m.user.name || 'Unknown']));

        for (const [userId, balance] of Object.entries(balances)) {
            if (balance < -1) { // threshold of 1 paisa to avoid floating errors
                debtors.push({ id: userId, name: memberMap.get(userId) || 'Unknown', amount: -balance });
            } else if (balance > 1) {
                creditors.push({ id: userId, name: memberMap.get(userId) || 'Unknown', amount: balance });
            }
        }

        debtors.sort((a, b) => b.amount - a.amount);
        creditors.sort((a, b) => b.amount - a.amount);

        const settlements: { from: string; fromName: string; to: string; toName: string; amount: number }[] = [];
        let di = 0, ci = 0;
        while (di < debtors.length && ci < creditors.length) {
            const transfer = Math.min(debtors[di].amount, creditors[ci].amount);
            if (transfer > 1) {
                settlements.push({
                    from: debtors[di].id,
                    fromName: debtors[di].name,
                    to: creditors[ci].id,
                    toName: creditors[ci].name,
                    amount: Math.round(transfer),
                });
            }
            debtors[di].amount -= transfer;
            creditors[ci].amount -= transfer;
            if (debtors[di].amount < 1) di++;
            if (creditors[ci].amount < 1) ci++;
        }

        return NextResponse.json({
            members: members.map(m => ({
                id: m.user.id,
                name: m.user.name,
                image: m.user.image,
                role: m.role,
                balance: balances[m.user.id] || 0,
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
