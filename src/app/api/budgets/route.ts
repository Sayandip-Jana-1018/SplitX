import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { logger } from '@/lib/logger';

/**
 * GET  /api/budgets — list user's budgets for a month (default: current)
 * POST /api/budgets — create/update budget for a category + month
 */

export async function GET(req: Request) {
    try {
        const session = await auth();
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const user = await prisma.user.findUnique({ where: { email: session.user.email } });
        if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

        const { searchParams } = new URL(req.url);
        const month = searchParams.get('month') || getCurrentMonth();

        const budgets = await prisma.budget.findMany({
            where: { userId: user.id, month },
            orderBy: { category: 'asc' },
        });

        return NextResponse.json({ data: budgets });
    } catch (error) {
        logger.error('Budgets GET error', { err: error });
        return NextResponse.json({ error: 'Failed to fetch budgets' }, { status: 500 });
    }
}

export async function POST(req: Request) {
    try {
        const session = await auth();
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const user = await prisma.user.findUnique({ where: { email: session.user.email } });
        if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

        const body = await req.json();
        const { category, amount, month } = body as { category: string; amount: number; month?: string };

        if (!category || typeof amount !== 'number' || amount <= 0) {
            return NextResponse.json({ error: 'Category and a positive amount are required.' }, { status: 400 });
        }

        const targetMonth = month || getCurrentMonth();

        // Upsert: create or update
        const budget = await prisma.budget.upsert({
            where: {
                userId_category_month: {
                    userId: user.id,
                    category,
                    month: targetMonth,
                },
            },
            update: { amount },
            create: {
                userId: user.id,
                category,
                amount,
                month: targetMonth,
            },
        });

        return NextResponse.json({ data: budget });
    } catch (error) {
        logger.error('Budgets POST error', { err: error });
        return NextResponse.json({ error: 'Failed to save budget' }, { status: 500 });
    }
}

function getCurrentMonth(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}
