import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { groupReceipts } from '@/lib/services/receipts';

// GET /api/groups/[groupId]/receipts — every expense with a receipt photo in a group, and its
// members (shared with the phone app's GET /api/v1/groups/:groupId/receipts).
export async function GET(
    _req: Request,
    { params }: { params: Promise<{ groupId: string }> }
) {
    try {
        const session = await auth();
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { groupId } = await params;
        const user = await prisma.user.findUnique({ where: { email: session.user.email } });
        if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

        const found = await groupReceipts(user.id, groupId);
        if (!found) {
            return NextResponse.json({ error: 'Group not found or access denied' }, { status: 404 });
        }
        return NextResponse.json(found);
    } catch (error) {
        logger.error('Failed to fetch receipts', { err: error });
        return NextResponse.json({ error: 'Failed to fetch receipts' }, { status: 500 });
    }
}
