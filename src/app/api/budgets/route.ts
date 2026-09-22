import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { istMonthKey } from '@/lib/indiaTime';

/**
 * GET  /api/budgets — list user's budgets for a month (default: this month in India)
 * POST /api/budgets — create/update budget for a category + month
 */

/** "2026-09" */
const Month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Month must look like 2026-09');

const BudgetSchema = z.object({
    category: z.string().trim().min(1).max(40),
    /** Paise, in a 32-bit column like every other amount. */
    amount: z.number().int().positive().max(2_147_483_647),
    month: Month.optional(),
});

export async function GET(req: Request) {
    try {
        const session = await auth();
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const user = await prisma.user.findUnique({ where: { email: session.user.email } });
        if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

        const { searchParams } = new URL(req.url);
        const month = Month.safeParse(searchParams.get('month') ?? istMonthKey(new Date()));
        if (!month.success) return NextResponse.json({ error: 'Month must look like 2026-09' }, { status: 400 });

        const budgets = await prisma.budget.findMany({
            where: { userId: user.id, month: month.data },
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

        const parsed = BudgetSchema.safeParse(await req.json().catch(() => null));
        if (!parsed.success) {
            return NextResponse.json({ error: 'A category, a whole positive amount in paise, and optionally a month like 2026-09 are required.' }, { status: 400 });
        }
        const { category, amount } = parsed.data;
        const targetMonth = parsed.data.month ?? istMonthKey(new Date());

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
