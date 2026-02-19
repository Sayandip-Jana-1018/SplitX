import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';

// POST /api/transactions/from-receipt — Create transaction with item-level splits from receipt OCR
export async function POST(req: Request) {
    try {
        const session = await auth();
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const user = await prisma.user.findUnique({ where: { email: session.user.email } });
        if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

        const body = await req.json();
        const {
            tripId,
            title,
            amount,       // total in paise
            category = 'general',
            items,         // { name, price, assignedTo[] }[]
            receiptUrl,
        } = body as {
            tripId: string;
            title: string;
            amount: number;
            category?: string;
            items: { name: string; price: number; assignedTo: string[] }[];
            receiptUrl?: string;
        };

        if (!tripId || !title || !amount || !items?.length) {
            return NextResponse.json({ error: 'Missing required fields: tripId, title, amount, items' }, { status: 400 });
        }

        // Verify user has access to this trip's group
        const trip = await prisma.trip.findUnique({
            where: { id: tripId },
            include: {
                group: {
                    include: {
                        members: { select: { userId: true } },
                    },
                },
            },
        });

        if (!trip) {
            return NextResponse.json({ error: 'Trip not found' }, { status: 404 });
        }

        const isMember = trip.group.ownerId === user.id ||
            trip.group.members.some(m => m.userId === user.id);
        if (!isMember) {
            return NextResponse.json({ error: 'Not a member of this group' }, { status: 403 });
        }

        // Compute per-user split amounts from item assignments
        const userAmounts: Record<string, number> = {};

        for (const item of items) {
            if (!item.assignedTo?.length) continue;
            const perPersonAmount = Math.round(item.price / item.assignedTo.length);
            for (const userId of item.assignedTo) {
                userAmounts[userId] = (userAmounts[userId] || 0) + perPersonAmount;
            }
        }

        // If some items were unassigned, split their cost equally among all assigned users
        const assignedTotal = Object.values(userAmounts).reduce((s, v) => s + v, 0);
        const remainder = amount - assignedTotal;

        if (remainder > 0 && Object.keys(userAmounts).length > 0) {
            const perPerson = Math.round(remainder / Object.keys(userAmounts).length);
            for (const userId of Object.keys(userAmounts)) {
                userAmounts[userId] += perPerson;
            }
        }

        // Create transaction with splits
        const transaction = await prisma.transaction.create({
            data: {
                tripId,
                payerId: user.id,
                amount,
                title,
                category,
                method: 'cash',
                splitType: 'items',
                receiptUrl: receiptUrl || null,
                splits: {
                    create: Object.entries(userAmounts).map(([userId, splitAmount]) => ({
                        userId,
                        amount: splitAmount,
                    })),
                },
            },
            include: {
                splits: { include: { user: { select: { id: true, name: true } } } },
                payer: { select: { id: true, name: true } },
            },
        });

        // Auto-send a group message about the new expense
        try {
            await prisma.groupMessage.create({
                data: {
                    groupId: trip.groupId,
                    senderId: user.id,
                    content: `💰 ${user.name || 'Someone'} added "${title}" — ${formatAmount(amount)} (${items.length} items, split by items)`,
                    type: 'expense_added',
                    transactionId: transaction.id,
                },
            });
        } catch {
            // Non-critical: don't fail if message creation fails
        }

        return NextResponse.json({ transaction });
    } catch (error) {
        console.error('From-receipt error:', error);
        return NextResponse.json({ error: 'Failed to create transaction from receipt' }, { status: 500 });
    }
}

function formatAmount(paise: number): string {
    return `₹${(paise / 100).toLocaleString('en-IN')}`;
}
