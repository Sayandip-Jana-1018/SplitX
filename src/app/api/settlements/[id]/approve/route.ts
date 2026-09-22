import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { createBulkNotifications, createNotification } from '@/lib/notifications';
import { refusalResponse, settlementRow, transitionSettlement, TransitionRefused } from '@/lib/settlementTransitions';
import { recordSettlementCompleted } from '@/lib/metrics';
import { logger } from '@/lib/logger';

const ApprovalSchema = z.object({
    action: z.enum(['approve', 'reject']).default('approve'),
});

// POST /api/settlements/:id/approve — the receiver approves a payment the payer
// marked as paid, or sends it back if the money hasn't arrived
// (lib/settlementTransitions.ts).
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
        const parsed = ApprovalSchema.safeParse(await req.json().catch(() => ({})));
        if (!parsed.success) {
            return NextResponse.json({ error: 'Invalid approval action' }, { status: 400 });
        }
        const approving = parsed.data.action === 'approve';

        const user = await prisma.user.findUnique({ where: { email: session.user.email } });
        if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

        let settlement;
        try {
            ({ after: settlement } = await transitionSettlement({
                settlementId: id,
                actorId: user.id,
                action: approving ? 'approve' : 'send_back',
            }));
        } catch (error) {
            if (error instanceof TransitionRefused) return refusalResponse(error);
            throw error;
        }

        const amount = `₹${(settlement.amount / 100).toLocaleString('en-IN')}`;

        if (approving) {
            recordSettlementCompleted(settlement.method, settlement.amount);

            await createNotification({
                userId: settlement.fromId,
                actorId: user.id,
                type: 'settlement_completed',
                title: 'Payment approved',
                body: `${settlement.to.name || 'Someone'} confirmed receiving ${amount} from you.`,
                link: '/settlements',
            });

            try {
                const group = await prisma.group.findUnique({
                    where: { id: settlement.trip.groupId },
                    include: { members: { select: { userId: true } } },
                });
                const otherMemberIds = (group?.members ?? [])
                    .map((member) => member.userId)
                    .filter((memberId) => memberId !== settlement.fromId && memberId !== settlement.toId);

                if (otherMemberIds.length > 0) {
                    await createBulkNotifications(otherMemberIds, {
                        actorId: user.id,
                        type: 'settlement_completed',
                        title: 'Settlement completed',
                        body: `${settlement.to.name || 'Someone'} approved ${amount} from ${settlement.from.name || 'someone'}.`,
                        link: '/settlements',
                    });
                }
            } catch {
                // non-fatal
            }

            await prisma.groupMessage.create({
                data: {
                    groupId: settlement.trip.groupId,
                    senderId: user.id,
                    type: 'system',
                    content: `✅ ${settlement.to.name || 'Someone'} confirmed receiving ₹${(settlement.amount / 100).toFixed(0)} from ${settlement.from.name || 'someone'}.`,
                    settlementId: settlement.id,
                },
            });

            return NextResponse.json({
                settlement: settlementRow(settlement),
                message: 'Payment approved and settlement completed.',
            });
        }

        await createNotification({
            userId: settlement.fromId,
            actorId: user.id,
            type: 'settlement_rejected',
            title: 'Payment still needs approval',
            body: `${settlement.to.name || 'The receiver'} has not approved your ${amount} payment yet. Please verify and try again.`,
            link: '/settlements',
        });

        return NextResponse.json({
            settlement: settlementRow(settlement),
            message: 'Approval request sent back to the payer for follow-up.',
        });
    } catch (error) {
        logger.error('Settlement approval error', { err: error });
        return NextResponse.json({ error: 'Failed to update settlement approval' }, { status: 500 });
    }
}
