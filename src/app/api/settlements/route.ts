import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { z } from 'zod';

const SettleSchema = z.object({
    tripId: z.string().cuid(),
    toUserId: z.string().cuid(),
    amount: z.number().int().positive(),
    method: z.string().default('upi'),
    note: z.string().optional(),
});

// GET /api/settlements?tripId=xxx — get computed settlements for a trip (or all trips if omitted)
export async function GET(req: Request) {
    try {
        const session = await auth();
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(req.url);
        let tripId = searchParams.get('tripId');

        // If no tripId, auto-detect from user's groups
        if (!tripId) {
            const user = await prisma.user.findUnique({ where: { email: session.user.email } });
            if (!user) return NextResponse.json({ computed: [], recorded: [], balances: {} });

            const trips = await prisma.trip.findMany({
                where: {
                    isActive: true,
                    group: {
                        OR: [
                            { ownerId: user.id },
                            { members: { some: { userId: user.id } } },
                        ],
                    },
                },
                select: { id: true },
                orderBy: { createdAt: 'desc' },
                take: 1,
            });

            if (trips.length === 0) {
                return NextResponse.json({ computed: [], recorded: [], balances: {} });
            }
            tripId = trips[0].id;
        }

        // Get all transactions + splits (excluding soft-deleted)
        const transactions = await prisma.transaction.findMany({
            where: { tripId, deletedAt: null },
            include: { splits: true },
        });

        // Calculate net balances
        const balances: Record<string, number> = {};

        for (const txn of transactions) {
            balances[txn.payerId] = (balances[txn.payerId] || 0) + txn.amount;
            for (const split of txn.splits) {
                balances[split.userId] = (balances[split.userId] || 0) - split.amount;
            }
        }

        // Account for recorded settlements (excluding soft-deleted)
        const completedSettlements = await prisma.settlement.findMany({
            where: {
                tripId: tripId!,
                status: { in: ['completed', 'confirmed'] },
                deletedAt: null,
            },
        });

        for (const s of completedSettlements) {
            balances[s.fromId] = (balances[s.fromId] || 0) + s.amount;
            balances[s.toId] = (balances[s.toId] || 0) - s.amount;
        }

        // Greedy netting: minimize transfers
        const debtors: { id: string; amount: number }[] = [];
        const creditors: { id: string; amount: number }[] = [];

        for (const [userId, balance] of Object.entries(balances)) {
            if (balance < -1) debtors.push({ id: userId, amount: -balance });
            else if (balance > 1) creditors.push({ id: userId, amount: balance });
        }

        debtors.sort((a, b) => b.amount - a.amount);
        creditors.sort((a, b) => b.amount - a.amount);

        const transfers: { from: string; to: string; amount: number }[] = [];
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

        // Resolve user names for computed transfers
        const allUserIds = new Set<string>();
        for (const t of transfers) { allUserIds.add(t.from); allUserIds.add(t.to); }
        const users = allUserIds.size > 0
            ? await prisma.user.findMany({
                where: { id: { in: Array.from(allUserIds) } },
                select: { id: true, name: true, image: true, upiId: true },
            })
            : [];
        const nameMap = Object.fromEntries(users.map(u => [u.id, u.name || 'Unknown']));
        const imageMap = Object.fromEntries(users.map(u => [u.id, u.image || null]));
        const upiMap = Object.fromEntries(users.map(u => [u.id, u.upiId || null]));

        const computedWithNames = transfers.map(t => ({
            ...t,
            fromName: nameMap[t.from] || 'Unknown',
            toName: nameMap[t.to] || 'Unknown',
            fromImage: imageMap[t.from] || null,
            toImage: imageMap[t.to] || null,
            toUpiId: upiMap[t.to] || null,
        }));

        // Get recorded settlements (excluding soft-deleted)
        const recorded = await prisma.settlement.findMany({
            where: { tripId, deletedAt: null },
            include: {
                from: { select: { id: true, name: true, image: true } },
                to: { select: { id: true, name: true, image: true } },
            },
            orderBy: { createdAt: 'desc' },
        });

        return NextResponse.json({
            computed: computedWithNames,
            recorded,
            balances,
        });
    } catch (error) {
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

        // ── Security: Duplicate check (same pair, same trip, within 60s) ──
        const sixtySecondsAgo = new Date(Date.now() - 60_000);
        const duplicate = await prisma.settlement.findFirst({
            where: {
                tripId: parsed.data.tripId,
                fromId: user.id,
                toId: parsed.data.toUserId,
                amount: parsed.data.amount,
                status: { in: ['completed', 'pending'] },
                createdAt: { gte: sixtySecondsAgo },
                deletedAt: null,
            },
        });
        if (duplicate) {
            return NextResponse.json(
                { error: 'A duplicate settlement was recorded less than a minute ago. Please wait.' },
                { status: 409 }
            );
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
            },
        });

        // ── Notify + chat only for immediately-completed (non-UPI) settlements ──
        if (!isUpi) {
            await prisma.notification.create({
                data: {
                    userId: parsed.data.toUserId,
                    type: 'settlement_completed',
                    title: 'Payment Settled',
                    body: `${user.name || 'Someone'} marked ₹${(parsed.data.amount / 100).toFixed(0)} as paid to you via ${parsed.data.method}.`,
                    link: '/settlements',
                },
            });

            await (prisma as any).groupMessage.create({
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
