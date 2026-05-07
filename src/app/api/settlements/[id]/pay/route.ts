import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { generateUpiLink } from '@/lib/upi';
import { canInitiateSettlementPayment, isAwaitingReceiverApproval, isCompletedSettlementStatus } from '@/lib/settlementStatus';

// POST /api/settlements/:id/pay — Generate UPI deep link and mark settlement as initiated
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

        // Fetch settlement with creditor's UPI ID
        const settlement = await prisma.settlement.findUnique({
            where: { id },
            include: {
                from: { select: { id: true, name: true, upiId: true } },
                to: { select: { id: true, name: true, upiId: true } },
            },
        });

        if (!settlement) {
            return NextResponse.json({ error: 'Settlement not found' }, { status: 404 });
        }

        // Only the debtor (from) can initiate payment
        if (settlement.fromId !== user.id) {
            return NextResponse.json(
                { error: 'Only the person who owes can initiate payment' },
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
                { error: 'This payment is already waiting for the receiver to approve it.' },
                { status: 400 }
            );
        }

        if (!canInitiateSettlementPayment(settlement.status)) {
            return NextResponse.json(
                { error: 'This settlement cannot be initiated right now.' },
                { status: 400 }
            );
        }

        // Check creditor has UPI ID
        if (!settlement.to.upiId) {
            return NextResponse.json(
                {
                    error: 'no_upi_id',
                    message: `${settlement.to.name || 'The recipient'} hasn't added their UPI ID yet. Ask them to add it in Settings → Payment.`,
                },
                { status: 400 }
            );
        }

        // Generate UPI deep link using shared utility
        const upiUrl = generateUpiLink({
            upiId: settlement.to.upiId,
            payeeName: settlement.to.name || 'SplitX User',
            amount: settlement.amount / 100,
            note: 'SplitX settlement',
        });

        await prisma.settlement.update({
            where: { id },
            data: {
                status: 'initiated',
                method: settlement.method || 'upi',
            },
        });

        return NextResponse.json({
            upiUrl,
            qrData: upiUrl, // Same URL is used for QR code generation
            amount: settlement.amount,
            payeeName: settlement.to.name,
            payeeUpiId: settlement.to.upiId,
        });
    } catch (error) {
        console.error('Settlement pay error:', error);
        return NextResponse.json({ error: 'Failed to generate payment link' }, { status: 500 });
    }
}
