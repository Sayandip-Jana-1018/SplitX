import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { z } from 'zod';
import { createNotification } from '@/lib/notifications';
import {
    canInitiateSettlementPayment,
    isCompletedSettlementStatus,
    isAwaitingReceiverApproval,
} from '@/lib/settlementStatus';

const ActionSchema = z.object({
    action: z.enum(['confirm', 'accept_cash', 'reject']).default('confirm'),
});

// POST /api/settlements/:id/confirm-by-receiver
// Allows the receiver to move a pending/initiated settlement to paid_pending
// so that the /approve endpoint can then finalize it.
export async function POST(
    _req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const session = await auth();
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { id } = await params;

        const user = await prisma.user.findUnique({ where: { email: session.user.email } });
        if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

        const settlement = await prisma.settlement.findFirst({
            where: { id, deletedAt: null },
            include: {
                from: { select: { id: true, name: true } },
                to: { select: { id: true, name: true } },
            },
        });

        if (!settlement) {
            return NextResponse.json({ error: 'Settlement not found' }, { status: 404 });
        }

        // Only the receiver (to) can use this endpoint
        if (settlement.toId !== user.id) {
            return NextResponse.json(
                { error: 'Only the receiver can use this endpoint' },
                { status: 403 }
            );
        }

        if (isCompletedSettlementStatus(settlement.status)) {
            return NextResponse.json(
                { error: 'This settlement has already been completed' },
                { status: 400 }
            );
        }

        const body = await _req.json().catch(() => ({}));
        const parsed = ActionSchema.safeParse(body);
        const action = parsed.success ? parsed.data.action : 'confirm';

        // ── REJECT: Cancel the settlement and notify sender ──
        if (action === 'reject') {
            if (isCompletedSettlementStatus(settlement.status)) {
                return NextResponse.json(
                    { error: 'Cannot reject a completed settlement' },
                    { status: 400 }
                );
            }
            await prisma.settlement.update({
                where: { id },
                data: { status: 'cancelled' },
            });
            // Notify sender
            try {
                await createNotification({
                    userId: settlement.fromId,
                    type: 'settlement_rejected',
                    title: 'Settlement Rejected',
                    body: `${settlement.to.name} rejected the settlement of ₹${settlement.amount}`,
                    link: '/settlements',
                });
            } catch { /* notification failures are non-critical */ }
            return NextResponse.json({ message: 'Settlement rejected and sender notified' });
        }

        // ── ACCEPT CASH: Directly complete (offline payment confirmed) ──
        if (action === 'accept_cash') {
            if (isCompletedSettlementStatus(settlement.status)) {
                return NextResponse.json(
                    { error: 'Already completed' },
                    { status: 400 }
                );
            }
            await prisma.settlement.update({
                where: { id },
                data: { status: 'completed', method: 'cash' },
            });
            // Notify sender
            try {
                await createNotification({
                    userId: settlement.fromId,
                    type: 'settlement_completed',
                    title: 'Settlement Completed',
                    body: `${settlement.to.name} confirmed receiving ₹${settlement.amount} (cash)`,
                    link: '/settlements',
                });
            } catch { /* notification failures are non-critical */ }
            return NextResponse.json({ message: 'Cash payment confirmed — settlement completed' });
        }

        // ── CONFIRM: Move to paid_pending (original flow) ──
        if (isAwaitingReceiverApproval(settlement.status)) {
            return NextResponse.json({ message: 'Already awaiting approval' });
        }

        if (!canInitiateSettlementPayment(settlement.status)) {
            return NextResponse.json(
                { error: 'Settlement cannot be transitioned from this state' },
                { status: 400 }
            );
        }

        await prisma.settlement.update({
            where: { id },
            data: { status: 'paid_pending' },
        });

        return NextResponse.json({ message: 'Settlement moved to paid_pending for approval' });
    } catch (error) {
        console.error('Settlement confirm-by-receiver error:', error);
        return NextResponse.json({ error: 'Failed to update settlement' }, { status: 500 });
    }
}
