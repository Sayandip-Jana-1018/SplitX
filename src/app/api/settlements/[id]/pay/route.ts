import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';

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

        // Check if already completed
        if (settlement.status === 'confirmed' || settlement.status === 'completed') {
            return NextResponse.json(
                { error: 'This settlement has already been completed' },
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

        // Generate UPI deep link
        const amountInRupees = (settlement.amount / 100).toFixed(2);
        const payeeName = encodeURIComponent(settlement.to.name || 'SplitX User');
        const note = encodeURIComponent(`SplitX settlement`);
        const upiUrl = `upi://pay?pa=${settlement.to.upiId}&pn=${payeeName}&am=${amountInRupees}&cu=INR&tn=${note}`;

        // Update settlement status to "initiated"
        await prisma.settlement.update({
            where: { id },
            data: { status: 'initiated' },
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
