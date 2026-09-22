import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { generateUpiLink } from '@/lib/upi';
import { refusalResponse, transitionSettlement, TransitionRefused } from '@/lib/settlementTransitions';
import { logger } from '@/lib/logger';

// POST /api/settlements/:id/pay — the payer opens their UPI app: returns the
// UPI link and marks the settlement as initiated (lib/settlementTransitions.ts).
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

        let settlement;
        try {
            ({ after: settlement } = await transitionSettlement({
                settlementId: id,
                actorId: user.id,
                action: 'open_upi',
                data: { method: 'upi' },
                guard: (current) => {
                    if (!current.to.upiId) {
                        throw new TransitionRefused(
                            `${current.to.name || 'The recipient'} hasn't added their UPI ID yet. Ask them to add it in Settings → Payment.`,
                            400,
                            'no_upi_id'
                        );
                    }
                },
            }));
        } catch (error) {
            if (error instanceof TransitionRefused) return refusalResponse(error);
            throw error;
        }

        const upiId = settlement.to.upiId as string;
        const upiUrl = generateUpiLink({
            upiId,
            payeeName: settlement.to.name || 'SplitX User',
            amount: settlement.amount / 100,
            note: 'SplitX settlement',
        });

        return NextResponse.json({
            upiUrl,
            qrData: upiUrl, // Same URL is used for QR code generation
            amount: settlement.amount,
            payeeName: settlement.to.name,
            payeeUpiId: upiId,
        });
    } catch (error) {
        logger.error('Settlement pay error', { err: error });
        return NextResponse.json({ error: 'Failed to generate payment link' }, { status: 500 });
    }
}
