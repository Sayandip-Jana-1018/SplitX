import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { refusalResponse, settlementRow, TransitionRefused } from '@/lib/settlementTransitions';
import { logger } from '@/lib/logger';
import { markPaid } from '@/lib/services/settlements';

const ConfirmSchema = z.object({
    action: z.literal('paid').optional(),
    method: z.enum(['upi', 'cash']).optional(),
    /** The UPI reference the payer's app showed, for the receiver to check. */
    utrNumber: z.string().trim().max(40).optional(),
});

// POST /api/settlements/:id/confirm — the payer says "I've paid"; the receiver
// then approves it (lib/settlementTransitions.ts).
export async function POST(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const session = await auth();
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { id } = await params;
        const parsed = ConfirmSchema.safeParse(await req.json().catch(() => ({})));
        if (!parsed.success) {
            return NextResponse.json({ error: 'Invalid payment confirmation' }, { status: 400 });
        }
        const paidInCash = parsed.data.method === 'cash';
        const utrNumber = parsed.data.utrNumber || undefined;

        const user = await prisma.user.findUnique({ where: { email: session.user.email } });
        if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

        let settlement;
        try {
            settlement = await markPaid(user, id, { cash: paidInCash, utrNumber });
        } catch (error) {
            if (error instanceof TransitionRefused) return refusalResponse(error);
            throw error;
        }

        return NextResponse.json({
            settlement: settlementRow(settlement),
            message: 'Payment request sent for receiver approval.',
        });
    } catch (error) {
        logger.error('Settlement confirm error', { err: error });
        return NextResponse.json({ error: 'Failed to confirm payment' }, { status: 500 });
    }
}
