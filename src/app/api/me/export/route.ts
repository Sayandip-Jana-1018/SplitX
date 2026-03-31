import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';

export async function GET() {
    try {
        const session = await auth();
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const user = await prisma.user.findUnique({
            where: { email: session.user.email },
            select: {
                id: true,
                name: true,
                email: true,
                image: true,
                phone: true,
                upiId: true,
                createdAt: true,
            },
        });

        if (!user) {
            return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }

        const [
            memberships,
            ownedGroups,
            transactionsPaid,
            transactionSplits,
            settlementsFrom,
            settlementsTo,
            budgets,
            contacts,
            notifications,
        ] = await Promise.all([
            prisma.groupMember.findMany({
                where: { userId: user.id },
                include: {
                    group: {
                        select: {
                            id: true,
                            name: true,
                            emoji: true,
                            createdAt: true,
                            deletedAt: true,
                        },
                    },
                },
                orderBy: { joinedAt: 'desc' },
            }),
            prisma.group.findMany({
                where: { ownerId: user.id },
                select: {
                    id: true,
                    name: true,
                    emoji: true,
                    createdAt: true,
                    deletedAt: true,
                },
                orderBy: { createdAt: 'desc' },
            }),
            prisma.transaction.findMany({
                where: { payerId: user.id },
                select: {
                    id: true,
                    title: true,
                    amount: true,
                    category: true,
                    method: true,
                    splitType: true,
                    createdAt: true,
                    deletedAt: true,
                    trip: {
                        select: {
                            id: true,
                            title: true,
                            group: { select: { id: true, name: true, emoji: true } },
                        },
                    },
                },
                orderBy: { createdAt: 'desc' },
            }),
            prisma.splitItem.findMany({
                where: { userId: user.id },
                select: {
                    id: true,
                    amount: true,
                    transaction: {
                        select: {
                            id: true,
                            title: true,
                            amount: true,
                            createdAt: true,
                            deletedAt: true,
                            payer: { select: { id: true, name: true } },
                            trip: {
                                select: {
                                    id: true,
                                    title: true,
                                    group: { select: { id: true, name: true, emoji: true } },
                                },
                            },
                        },
                    },
                },
                orderBy: { transaction: { createdAt: 'desc' } },
            }),
            prisma.settlement.findMany({
                where: { fromId: user.id, deletedAt: null },
                select: {
                    id: true,
                    amount: true,
                    status: true,
                    method: true,
                    createdAt: true,
                    to: { select: { id: true, name: true } },
                    trip: {
                        select: {
                            id: true,
                            title: true,
                            group: { select: { id: true, name: true, emoji: true } },
                        },
                    },
                },
                orderBy: { createdAt: 'desc' },
            }),
            prisma.settlement.findMany({
                where: { toId: user.id, deletedAt: null },
                select: {
                    id: true,
                    amount: true,
                    status: true,
                    method: true,
                    createdAt: true,
                    from: { select: { id: true, name: true } },
                    trip: {
                        select: {
                            id: true,
                            title: true,
                            group: { select: { id: true, name: true, emoji: true } },
                        },
                    },
                },
                orderBy: { createdAt: 'desc' },
            }),
            prisma.budget.findMany({
                where: { userId: user.id },
                orderBy: [{ month: 'desc' }, { category: 'asc' }],
            }),
            prisma.contact.findMany({
                where: { ownerId: user.id },
                orderBy: { addedAt: 'desc' },
            }),
            prisma.notification.findMany({
                where: { userId: user.id },
                select: {
                    id: true,
                    type: true,
                    title: true,
                    body: true,
                    read: true,
                    createdAt: true,
                },
                orderBy: { createdAt: 'desc' },
                take: 100,
            }),
        ]);

        return NextResponse.json({
            exportedAt: new Date().toISOString(),
            user,
            groups: {
                memberships,
                owned: ownedGroups,
            },
            finances: {
                transactionsPaid,
                transactionSplits,
                settlementsFrom,
                settlementsTo,
                budgets,
            },
            contacts,
            notifications,
        });
    } catch (error) {
        console.error('Export my data error:', error);
        return NextResponse.json({ error: 'Failed to export data' }, { status: 500 });
    }
}
