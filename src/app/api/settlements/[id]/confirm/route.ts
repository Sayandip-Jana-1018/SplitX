import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';

// POST /api/settlements/:id/confirm — Payer confirms "I've Paid" → immediately completes settlement
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

        const settlement = await prisma.settlement.findUnique({
            where: { id },
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

        // Check if already completed
        if (settlement.status === 'completed' || settlement.status === 'confirmed') {
            return NextResponse.json(
                { error: 'This settlement has already been completed' },
                { status: 400 }
            );
        }

        // ── Directly mark as completed (trust-based for friends) ──
        const updated = await prisma.settlement.update({
            where: { id },
            data: {
                status: 'completed',
                ...(utrNumber ? { utrNumber } : {}),
                method: 'upi',
            },
        });

        // ── Notify the receiver ──
        await prisma.notification.create({
            data: {
                userId: settlement.toId,
                type: 'settlement_completed',
                title: 'Payment Received',
                body: `${settlement.from.name || 'Someone'} paid you ₹${(settlement.amount / 100).toFixed(0)} via UPI${utrNumber ? ` (UTR: ${utrNumber})` : ''}.`,
                link: `/settlements`,
            },
        });

        // ── Auto-post settlement message in group chat ──
        if (settlement.trip?.groupId) {
            await (prisma as any).groupMessage.create({
                data: {
                    groupId: settlement.trip.groupId,
                    senderId: user.id,
                    type: 'system',
                    content: `💸 ${settlement.from.name || 'Someone'} paid ₹${(settlement.amount / 100).toFixed(0)} to ${settlement.to.name || 'someone'} via UPI`,
                    settlementId: settlement.id,
                },
            });
        }

        return NextResponse.json({ settlement: updated, message: 'Payment completed!' });
    } catch (error) {
        console.error('Settlement confirm error:', error);
        return NextResponse.json({ error: 'Failed to confirm payment' }, { status: 500 });
    }
}
