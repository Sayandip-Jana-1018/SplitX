import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { refusalResponse, settlementRow, TransitionRefused } from '@/lib/settlementTransitions';
import { logger } from '@/lib/logger';
import { decideApproval } from '@/lib/services/settlements';

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
            settlement = await decideApproval(user, id, approving);
        } catch (error) {
            if (error instanceof TransitionRefused) return refusalResponse(error);
            throw error;
        }

        return NextResponse.json({
            settlement: settlementRow(settlement),
            message: approving ? 'Payment approved and settlement completed.' : 'Approval request sent back to the payer for follow-up.',
        });
    } catch (error) {
        logger.error('Settlement approval error', { err: error });
        return NextResponse.json({ error: 'Failed to update settlement approval' }, { status: 500 });
    }
}
