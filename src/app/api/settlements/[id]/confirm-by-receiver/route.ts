import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { refusalResponse, TransitionRefused } from '@/lib/settlementTransitions';
import { logger } from '@/lib/logger';
import { receiverRecords } from '@/lib/services/settlements';

const ActionSchema = z.object({
    action: z.enum(['confirm', 'accept_cash', 'reject']).default('confirm'),
});


// POST /api/settlements/:id/confirm-by-receiver — the receiver records what
// happened: they were handed cash (completed), it was never paid (cancelled),
// or the payer has paid and it only needs approving (lib/settlementTransitions.ts).
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
        const parsed = ActionSchema.safeParse(await req.json().catch(() => ({})));
        if (!parsed.success) {
            return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
        }
        const { action } = parsed.data;

        const user = await prisma.user.findUnique({ where: { email: session.user.email } });
        if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

        try {
            await receiverRecords(user, id, action);
        } catch (error) {
            if (error instanceof TransitionRefused) return refusalResponse(error);
            throw error;
        }

        if (action === 'reject') return NextResponse.json({ message: 'Settlement rejected and sender notified' });
        if (action === 'accept_cash') return NextResponse.json({ message: 'Cash payment confirmed — settlement completed' });
        return NextResponse.json({ message: 'Settlement moved to paid_pending for approval' });
    } catch (error) {
        logger.error('Settlement confirm-by-receiver error', { err: error });
        return NextResponse.json({ error: 'Failed to update settlement' }, { status: 500 });
    }
}
