import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';

// GET /api/groups/:groupId — full group detail
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
        if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

        const group = await prisma.group.findFirst({
            where: {
                id: groupId,
                OR: [
                    { ownerId: user.id },
                    { members: { some: { userId: user.id } } },
                ],
            },
            include: {
                members: {
                    include: {
                        user: { select: { id: true, name: true, email: true, image: true } },
                    },
                },
                trips: {
                    orderBy: { createdAt: 'desc' },
                    include: {
                        transactions: {
                            where: { deletedAt: null },
                            include: {
                                payer: { select: { id: true, name: true } },
                                splits: { include: { user: { select: { id: true, name: true } } } },
                            },
                            orderBy: { createdAt: 'desc' },
                        },
                        settlements: {
                            include: {
                                from: { select: { id: true, name: true, image: true } },
                                to: { select: { id: true, name: true, image: true } },
                            },
                            orderBy: { createdAt: 'desc' },
                        },
                    },
                },
            },
        });

        if (!group) {
            return NextResponse.json({ error: 'Group not found' }, { status: 404 });
        }

        // Compute member balances from all trips
        const balances: Record<string, number> = {};
        for (const member of group.members) {
            balances[member.userId] = 0;
        }

        for (const trip of group.trips) {
            for (const txn of trip.transactions) {
                balances[txn.payerId] = (balances[txn.payerId] || 0) + txn.amount;
                for (const split of txn.splits) {
                    balances[split.userId] = (balances[split.userId] || 0) - split.amount;
                }
            }
        }

        // Compute total spent
        let totalSpent = 0;
        for (const trip of group.trips) {
            for (const txn of trip.transactions) {
                totalSpent += txn.amount;
            }
        }

        // Get the active trip (or most recent)
        const activeTrip = group.trips.find(t => t.isActive) || group.trips[0] || null;

        return NextResponse.json({
            ...group,
            totalSpent,
            activeTrip,
            balances,
            currentUserId: user.id,
        });
    } catch (error) {
        console.error('Group detail error:', error);
        return NextResponse.json({ error: 'Failed to fetch group' }, { status: 500 });
    }
}
