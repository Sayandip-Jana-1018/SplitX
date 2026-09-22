import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { createNotification } from '@/lib/notifications';
import { recordSettlementCompleted } from '@/lib/metrics';
import { refusalResponse, transitionSettlement, TransitionRefused, type SettlementAction } from '@/lib/settlementTransitions';
import { logger } from '@/lib/logger';

const ActionSchema = z.object({
    action: z.enum(['confirm', 'accept_cash', 'reject']).default('confirm'),
});

const MOVES: Record<z.infer<typeof ActionSchema>['action'], SettlementAction> = {
    confirm: 'mark_received',
    accept_cash: 'accept_cash',
    reject: 'decline',
};

const formatRupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN')}`;

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

        let settlement;
        try {
            ({ after: settlement } = await transitionSettlement({
                settlementId: id,
                actorId: user.id,
                action: MOVES[action],
                ...(action === 'accept_cash' ? { data: { method: 'cash' } } : {}),
            }));
        } catch (error) {
            if (error instanceof TransitionRefused) return refusalResponse(error);
            throw error;
        }

        if (action === 'reject') {
            try {
                await createNotification({
                    userId: settlement.fromId,
                    type: 'settlement_rejected',
                    title: 'Settlement Rejected',
                    body: `${settlement.to.name || 'The receiver'} marked your ${formatRupees(settlement.amount)} payment as not received`,
                    link: '/settlements',
                });
            } catch { /* notification failures are non-critical */ }
            return NextResponse.json({ message: 'Settlement rejected and sender notified' });
        }

        if (action === 'accept_cash') {
            recordSettlementCompleted('cash', settlement.amount);
            try {
                await createNotification({
                    userId: settlement.fromId,
                    type: 'settlement_completed',
                    title: 'Settlement Completed',
                    body: `${settlement.to.name || 'The receiver'} confirmed receiving ${formatRupees(settlement.amount)} in cash`,
                    link: '/settlements',
                });
            } catch { /* notification failures are non-critical */ }
            return NextResponse.json({ message: 'Cash payment confirmed — settlement completed' });
        }

        return NextResponse.json({ message: 'Settlement moved to paid_pending for approval' });
    } catch (error) {
        logger.error('Settlement confirm-by-receiver error', { err: error });
        return NextResponse.json({ error: 'Failed to update settlement' }, { status: 500 });
    }
}
