import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';

const CATEGORY_LABELS: Record<string, string> = {
    food: 'Food',
    transport: 'Transport',
    stay: 'Stay',
    shopping: 'Shopping',
    tickets: 'Tickets',
    entertainment: 'Entertainment',
    general: 'General',
    utilities: 'Utilities',
    groceries: 'Groceries',
    health: 'Health',
    education: 'Education',
    other: 'Other',
};

function monthKey(date: Date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export async function GET(req: Request) {
    try {
        const session = await auth();
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(req.url);
        const requestedGroupId = searchParams.get('groupId');

        const user = await prisma.user.findUnique({ where: { email: session.user.email } });
        if (!user) {
            return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }

        const availableGroups = await prisma.group.findMany({
            where: {
                deletedAt: null,
                OR: [
                    { ownerId: user.id },
                    { members: { some: { userId: user.id } } },
                ],
            },
            include: {
                owner: { select: { id: true, name: true, image: true } },
                members: {
                    include: { user: { select: { id: true, name: true, image: true } } },
                },
                trips: {
                    select: {
                        id: true,
                        transactions: {
                            where: { deletedAt: null },
                            select: { amount: true },
                        },
                    },
                },
            },
            orderBy: { updatedAt: 'desc' },
        });

        const groupOptions = availableGroups.map((group) => ({
            id: group.id,
            name: group.name,
            emoji: group.emoji,
            memberCount: new Set([group.ownerId, ...group.members.map((member) => member.userId)]).size,
            totalSpent: group.trips.reduce(
                (sum, trip) => sum + trip.transactions.reduce((tripSum, transaction) => tripSum + transaction.amount, 0),
                0
            ),
        }));

        if (groupOptions.length === 0) {
            return NextResponse.json({
                groups: [],
                selectedGroupId: null,
                data: {
                    monthlyTrend: [],
                    categoryBreakdown: [],
                    memberSpending: [],
                    insights: [],
                    currentMonth: monthKey(new Date()),
                    totalThisMonth: 0,
                    transactionCount: 0,
                    memberCount: 0,
                    groupName: null,
                    groupEmoji: null,
                },
            });
        }

        const selectedGroup =
            (requestedGroupId && availableGroups.find((group) => group.id === requestedGroupId)) ||
            availableGroups[0];

        if (!selectedGroup) {
            return NextResponse.json({ error: 'Group not found' }, { status: 404 });
        }

        const tripIds = selectedGroup.trips.map((trip) => trip.id);
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

        const [transactions, currentMonthSettlements] = await Promise.all([
            prisma.transaction.findMany({
                where: {
                    tripId: { in: tripIds },
                    deletedAt: null,
                    date: { gte: sixMonthsAgo },
                },
                include: {
                    splits: true,
                    payer: { select: { id: true, name: true, image: true } },
                },
                orderBy: { date: 'asc' },
            }),
            prisma.settlement.findMany({
                where: {
                    tripId: { in: tripIds },
                    status: { in: ['completed', 'confirmed'] },
                    deletedAt: null,
                    createdAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
                },
                select: { amount: true },
            }),
        ]);

        const now = new Date();
        const currentMonth = monthKey(now);
        const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const lastMonth = monthKey(lastMonthDate);

        const monthlyMap = new Map<string, number>();
        const categoryMap = new Map<string, number>();
        const lastMonthCategoryMap = new Map<string, number>();
        const memberSpendMap = new Map<string, { name: string; image: string | null; amount: number }>();
        let currentMonthTotal = 0;

        memberSpendMap.set(selectedGroup.owner.id, {
            name: selectedGroup.owner.name || 'Unknown',
            image: selectedGroup.owner.image || null,
            amount: 0,
        });
        for (const member of selectedGroup.members) {
            memberSpendMap.set(member.user.id, {
                name: member.user.name || 'Unknown',
                image: member.user.image || null,
                amount: 0,
            });
        }

        for (const transaction of transactions) {
            const key = monthKey(new Date(transaction.date));
            monthlyMap.set(key, (monthlyMap.get(key) || 0) + transaction.amount);

            if (!memberSpendMap.has(transaction.payerId)) {
                memberSpendMap.set(transaction.payerId, {
                    name: transaction.payer.name || 'Unknown',
                    image: transaction.payer.image || null,
                    amount: 0,
                });
            }
            const payerSpend = memberSpendMap.get(transaction.payerId)!;
            payerSpend.amount += transaction.amount;

            if (key === currentMonth) {
                const category = transaction.category || 'general';
                categoryMap.set(category, (categoryMap.get(category) || 0) + transaction.amount);
                currentMonthTotal += transaction.amount;
            }

            if (key === lastMonth) {
                const category = transaction.category || 'general';
                lastMonthCategoryMap.set(category, (lastMonthCategoryMap.get(category) || 0) + transaction.amount);
            }
        }

        const monthlyTrend = [];
        for (let i = 5; i >= 0; i -= 1) {
            const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const key = monthKey(date);
            monthlyTrend.push({ month: key, total: monthlyMap.get(key) || 0 });
        }

        const categoryBreakdown = Array.from(categoryMap.entries())
            .map(([category, amount]) => ({
                category,
                label: CATEGORY_LABELS[category] || category,
                amount,
                percentage: currentMonthTotal > 0 ? Math.round((amount / currentMonthTotal) * 100) : 0,
            }))
            .sort((a, b) => b.amount - a.amount);

        const memberSpending = Array.from(memberSpendMap.values())
            .filter((member) => member.amount > 0)
            .sort((a, b) => b.amount - a.amount);

        const insights: { type: string; message: string; severity: 'info' | 'warning' | 'success' }[] = [];

        const thisMonthTotal = monthlyTrend[monthlyTrend.length - 1]?.total || 0;
        const previousMonthTotal = monthlyTrend[monthlyTrend.length - 2]?.total || 0;
        if (previousMonthTotal > 0) {
            const change = Math.round(((thisMonthTotal - previousMonthTotal) / previousMonthTotal) * 100);
            if (change >= 15) {
                insights.push({
                    type: 'monthly-up',
                    message: `${selectedGroup.name} is up ${change}% versus last month.`,
                    severity: 'info',
                });
            } else if (change <= -15) {
                insights.push({
                    type: 'monthly-down',
                    message: `${selectedGroup.name} is down ${Math.abs(change)}% versus last month.`,
                    severity: 'success',
                });
            }
        }

        if (categoryBreakdown.length > 0) {
            const topCategory = categoryBreakdown[0];
            const lastMonthAmount = lastMonthCategoryMap.get(topCategory.category) || 0;
            if (lastMonthAmount > 0) {
                const categoryChange = Math.round(((topCategory.amount - lastMonthAmount) / lastMonthAmount) * 100);
                insights.push({
                    type: 'top-category',
                    message: `${topCategory.label} leads this month at ${topCategory.percentage}% of group spend${Math.abs(categoryChange) >= 10 ? `, ${categoryChange > 0 ? 'up' : 'down'} ${Math.abs(categoryChange)}% from last month` : ''}.`,
                    severity: categoryChange > 20 ? 'warning' : 'info',
                });
            } else {
                insights.push({
                    type: 'top-category',
                    message: `${topCategory.label} leads this month at ${topCategory.percentage}% of group spend.`,
                    severity: 'info',
                });
            }
        }

        if (memberSpending.length > 0) {
            const topPayer = memberSpending[0];
            insights.push({
                type: 'top-payer',
                message: `${topPayer.name} has paid the most so far with ${formatCompactAmount(topPayer.amount)}.`,
                severity: 'success',
            });
        }

        const settlementTotal = currentMonthSettlements.reduce((sum, settlement) => sum + settlement.amount, 0);
        if (settlementTotal > 0) {
            insights.push({
                type: 'settlements',
                message: `${formatCompactAmount(settlementTotal)} settled inside ${selectedGroup.name} this month.`,
                severity: 'info',
            });
        }

        return NextResponse.json({
            groups: groupOptions,
            selectedGroupId: selectedGroup.id,
            data: {
                monthlyTrend,
                categoryBreakdown,
                memberSpending,
                insights,
                currentMonth,
                totalThisMonth: currentMonthTotal,
                transactionCount: transactions.filter((transaction) => monthKey(new Date(transaction.date)) === currentMonth).length,
                memberCount: new Set([selectedGroup.ownerId, ...selectedGroup.members.map((member) => member.userId)]).size,
                groupName: selectedGroup.name,
                groupEmoji: selectedGroup.emoji,
            },
        });
    } catch (error) {
        console.error('Analytics GET error:', error);
        return NextResponse.json({ error: 'Failed to compute analytics' }, { status: 500 });
    }
}

function formatCompactAmount(amount: number) {
    return `₹${(amount / 100).toLocaleString('en-IN', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
    })}`;
}
