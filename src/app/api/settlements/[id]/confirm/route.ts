import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { createAuditLog } from '@/lib/auditLog';
import { serializeSettlementAuditSnapshot } from '@/lib/auditPayloads';
import { createNotification } from '@/lib/notifications';
import {
    canInitiateSettlementPayment,
    isAwaitingReceiverApproval,
    isCompletedSettlementStatus,
} from '@/lib/settlementStatus';

// POST /api/settlements/:id/confirm — Payer confirms "I've Paid" → receiver must approve
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
        const { utrNumber } = body as { utrNumber?: string };

        const user = await prisma.user.findUnique({ where: { email: session.user.email } });
        if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

        const settlement = await prisma.settlement.findFirst({
            where: { id, deletedAt: null },
            include: {
                from: { select: { id: true, name: true } },
                to: { select: { id: true, name: true } },
                trip: { select: { groupId: true } },
            },
        });

        if (!settlement) {
            return NextResponse.json({ error: 'Settlement not found' }, { status: 404 });
        }

        // Only the debtor (from) can confirm payment
        if (settlement.fromId !== user.id) {
            return NextResponse.json(
                { error: 'Only the person who owes can confirm payment' },
                { status: 403 }
            );
        }

        if (isCompletedSettlementStatus(settlement.status)) {
            return NextResponse.json(
                { error: 'This settlement has already been completed' },
                { status: 400 }
            );
        }

        if (isAwaitingReceiverApproval(settlement.status)) {
            return NextResponse.json(
                { error: 'This payment is already waiting for receiver approval' },
                { status: 400 }
            );
        }

        if (!canInitiateSettlementPayment(settlement.status)) {
            return NextResponse.json(
                { error: 'This settlement can no longer be confirmed from the payer side.' },
                { status: 400 }
            );
        }

        const updated = await prisma.settlement.update({
            where: { id },
            data: {
                status: 'paid_pending',
                ...(utrNumber ? { utrNumber } : {}),
                method: 'upi',
            },
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

        await createNotification({
            userId: settlement.toId,
            actorId: user.id,
            type: 'settlement_approval_request',
            title: 'Payment approval needed',
            body: `${settlement.from.name || 'Someone'} says they paid you ₹${(settlement.amount / 100).toLocaleString('en-IN')}. Approve it once you receive the money${utrNumber ? ` (UTR: ${utrNumber})` : ''}.`,
            link: '/settlements',
        });

        return NextResponse.json({
            settlement: updated,
            message: 'Payment request sent for receiver approval.',
        });
    } catch (error) {
        console.error('Settlement confirm error:', error);
        return NextResponse.json({ error: 'Failed to confirm payment' }, { status: 500 });
    }
}
