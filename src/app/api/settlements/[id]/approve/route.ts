import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { z } from 'zod';
import { createAuditLog } from '@/lib/auditLog';
import { serializeSettlementAuditSnapshot } from '@/lib/auditPayloads';
import { createBulkNotifications, createNotification } from '@/lib/notifications';
import { isAwaitingReceiverApproval, isCompletedSettlementStatus } from '@/lib/settlementStatus';

const ApprovalSchema = z.object({
    action: z.enum(['approve', 'reject']).default('approve'),
});

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
        const body = await req.json().catch(() => ({}));
        const parsed = ApprovalSchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json({ error: 'Invalid approval action' }, { status: 400 });
        }

        const user = await prisma.user.findUnique({ where: { email: session.user.email } });
        if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

        const settlement = await prisma.settlement.findFirst({
            where: { id, deletedAt: null },
            include: {
                from: { select: { id: true, name: true } },
                to: { select: { id: true, name: true } },
                trip: { select: { id: true, title: true, groupId: true } },
            },
        });

        if (!settlement) {
            return NextResponse.json({ error: 'Settlement not found' }, { status: 404 });
        }

        if (settlement.toId !== user.id) {
            return NextResponse.json(
                { error: 'Only the receiver can approve this payment' },
                { status: 403 }
            );
        }

        if (isCompletedSettlementStatus(settlement.status)) {
            return NextResponse.json(
                { error: 'This settlement has already been completed' },
                { status: 400 }
            );
        }

        if (!isAwaitingReceiverApproval(settlement.status)) {
            return NextResponse.json(
                { error: 'This settlement is not waiting for receiver approval yet' },
                { status: 400 }
            );
        }

        const nextStatus = parsed.data.action === 'approve' ? 'completed' : 'initiated';
        const updated = await prisma.settlement.update({
            where: { id },
            data: { status: nextStatus },
        });

        await createAuditLog({
            userId: user.id,
            action: 'update',
            entityType: 'settlement',
            entityId: settlement.id,
            details: {
                groupId: settlement.trip.groupId,
                tripId: settlement.tripId,
                before: serializeSettlementAuditSnapshot({
                    id: settlement.id,
                    tripId: settlement.tripId,
                    tripTitle: settlement.trip.title,
                    fromId: settlement.fromId,
                    fromName: settlement.from.name,
                    toId: settlement.toId,
                    toName: settlement.to.name,
                    amount: settlement.amount,
                    status: settlement.status,
                    method: settlement.method,
                    note: settlement.note,
                    createdAt: settlement.createdAt,
                    updatedAt: settlement.updatedAt,
                    deletedAt: settlement.deletedAt,
                }),
                after: serializeSettlementAuditSnapshot({
                    id: updated.id,
                    tripId: updated.tripId,
                    tripTitle: settlement.trip.title,
                    fromId: settlement.fromId,
                    fromName: settlement.from.name,
                    toId: settlement.toId,
                    toName: settlement.to.name,
                    amount: updated.amount,
                    status: updated.status,
                    method: updated.method,
                    note: updated.note,
                    createdAt: updated.createdAt,
                    updatedAt: updated.updatedAt,
                    deletedAt: updated.deletedAt,
                }),
            },
        });

        if (parsed.data.action === 'approve') {
            await createNotification({
                userId: settlement.fromId,
                actorId: user.id,
                type: 'settlement_completed',
                title: 'Payment approved',
                body: `${settlement.to.name || 'Someone'} confirmed receiving ₹${(settlement.amount / 100).toLocaleString('en-IN')} from you.`,
                link: '/settlements',
            });

            try {
                const groupWithMembers = await prisma.group.findUnique({
                    where: { id: settlement.trip.groupId },
                    include: { members: { select: { userId: true } } },
                });

                if (groupWithMembers) {
                    const otherMemberIds = groupWithMembers.members
                        .map((member) => member.userId)
                        .filter((memberId) => memberId !== settlement.fromId && memberId !== settlement.toId);

                    if (otherMemberIds.length > 0) {
                        await createBulkNotifications(otherMemberIds, {
                            actorId: user.id,
                            type: 'settlement_completed',
                            title: 'Settlement completed',
                            body: `${settlement.to.name || 'Someone'} approved ₹${(settlement.amount / 100).toLocaleString('en-IN')} from ${settlement.from.name || 'someone'}.`,
                            link: '/settlements',
                        });
                    }
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
                settlement: updated,
                message: 'Payment approved and settlement completed.',
            });
        }

        await createNotification({
            userId: settlement.fromId,
            actorId: user.id,
            type: 'settlement_rejected',
            title: 'Payment still needs approval',
            body: `${settlement.to.name || 'The receiver'} has not approved your ₹${(settlement.amount / 100).toLocaleString('en-IN')} payment yet. Please verify and try again.`,
            link: '/settlements',
        });

        return NextResponse.json({
            settlement: updated,
            message: 'Approval request sent back to the payer for follow-up.',
        });
    } catch (error) {
        console.error('Settlement approval error:', error);
        return NextResponse.json({ error: 'Failed to update settlement approval' }, { status: 500 });
    }
}
