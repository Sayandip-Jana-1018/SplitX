import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { refusalResponse, TransitionRefused } from '@/lib/settlementTransitions';
import { logger } from '@/lib/logger';
import { openUpi } from '@/lib/services/settlements';

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

        let opened;
        try {
            opened = await openUpi(user, id);
        } catch (error) {
            if (error instanceof TransitionRefused) return refusalResponse(error);
            throw error;
        }
        const { settlement, upiUrl, upiId } = opened;

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
