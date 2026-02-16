import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';

// GET /api/search?q=query — search across transactions, groups
export async function GET(req: Request) {
    try {
        const session = await auth();
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(req.url);
        const q = searchParams.get('q')?.trim();

        if (!q || q.length < 2) {
            return NextResponse.json({ transactions: [], groups: [] });
        }

        const user = await prisma.user.findUnique({ where: { email: session.user.email } });
        if (!user) return NextResponse.json({ transactions: [], groups: [] });

        // Search groups user belongs to
        const groups = await prisma.group.findMany({
            where: {
                OR: [
                    { ownerId: user.id },
                    { members: { some: { userId: user.id } } },
                ],
                name: { contains: q, mode: 'insensitive' },
            },
            select: {
                id: true,
                name: true,
                emoji: true,
                _count: { select: { members: true } },
            },
            take: 5,
        });

        // Search transactions across all user's groups
        const transactions = await prisma.transaction.findMany({
            where: {
                trip: {
                    group: {
                        OR: [
                            { ownerId: user.id },
                            { members: { some: { userId: user.id } } },
                        ],
                    },
                },
                title: { contains: q, mode: 'insensitive' },
            },
            include: {
                payer: { select: { id: true, name: true } },
                trip: { select: { group: { select: { id: true, name: true, emoji: true } } } },
            },
            orderBy: { createdAt: 'desc' },
            take: 10,
        });

        return NextResponse.json({ transactions, groups });
    } catch (error) {
        console.error('Search error:', error);
        return NextResponse.json({ error: 'Search failed' }, { status: 500 });
    }
}
