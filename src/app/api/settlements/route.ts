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

        // Determine which trip IDs to aggregate
        let tripIds: string[] = [];

        if (tripId) {
            // Specific trip requested
            tripIds = [tripId];
        } else {
            // Aggregate across ALL trips from ALL the user's groups
            const trips = await prisma.trip.findMany({
                where: {
                    group: {
                        OR: [
                            { ownerId: user.id },
                            { members: { some: { userId: user.id } } },
                        ],
                    },
                },
                select: { id: true },
            });

            if (trips.length === 0) {
                return NextResponse.json({ computed: [], recorded: [], balances: {} });
            }
            tripIds = trips.map(t => t.id);
        }

        // Get all transactions + splits across all relevant trips (excluding soft-deleted)
        const transactions = await prisma.transaction.findMany({
            where: { tripId: { in: tripIds }, deletedAt: null },
            include: { splits: true },
        });

        // Calculate net balances across all trips for reference
        const balances: Record<string, number> = {};
        for (const txn of transactions) {
            balances[txn.payerId] = (balances[txn.payerId] || 0) + txn.amount;
            for (const split of txn.splits) {
                balances[split.userId] = (balances[split.userId] || 0) - split.amount;
            }
        }

        const completedSettlements = await prisma.settlement.findMany({
            where: {
                tripId: { in: tripIds },
                status: { in: ['completed', 'confirmed'] },
                deletedAt: null,
            },
        });

        for (const s of completedSettlements) {
            balances[s.fromId] = (balances[s.fromId] || 0) + s.amount;
            balances[s.toId] = (balances[s.toId] || 0) - s.amount;
        }

        const transfers: { from: string; to: string; amount: number }[] = [];

        if (tripId) {
            // ** TRIP-SPECIFIC VIEW: Greedy netting (Simplify Debts) **
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
        } else {
            // ** GLOBAL VIEW: Exact Pairwise Debts **
            // We do not greedy net globally because users have incomplete disjoint universes.
            const pairwise = new Map<string, number>();

            const addDebt = (fromId: string, toId: string, amount: number) => {
                if (fromId === toId) return;
                const key = fromId < toId ? `${fromId}:${toId}` : `${toId}:${fromId}`;
                const sign = fromId < toId ? 1 : -1;
                const current = pairwise.get(key) || 0;
                pairwise.set(key, current + (amount * sign));
            };

            for (const txn of transactions) {
                for (const split of txn.splits) {
                    // split.userId owes txn.payerId
                    addDebt(split.userId, txn.payerId, split.amount);
                }
            }
            for (const s of completedSettlements) {
                // s.fromId paid s.toId => reduces debt or builds credit
                addDebt(s.fromId, s.toId, -s.amount);
            }

            for (const [key, amount] of pairwise.entries()) {
                if (Math.abs(amount) < 1) continue;
                const [userA, userB] = key.split(':');
                if (amount > 0) {
                    // userA owes userB
                    transfers.push({ from: userA, to: userB, amount });
                } else {
                    // userB owes userA
                    transfers.push({ from: userB, to: userA, amount: -amount });
                }
            }
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

        // Get recorded settlements across all trips (excluding soft-deleted)
        const recorded = await prisma.settlement.findMany({
            where: { tripId: { in: tripIds }, deletedAt: null },
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
