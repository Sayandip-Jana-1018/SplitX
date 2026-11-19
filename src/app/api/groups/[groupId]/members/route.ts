import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { removeMember } from '@/lib/services/groups';

const RemoveMemberSchema = z.object({ userId: z.string().min(1).max(64) });

/**
 * DELETE /api/groups/:groupId/members: the owner or an admin removes someone who is square in
 * the group. The rules live in the shared service (removeMember), which the phone app's
 * DELETE /api/v1/groups/:groupId/members/:userId calls too.
 */
export async function DELETE(
    req: Request,
    { params }: { params: Promise<{ groupId: string }> }
) {
    try {
        const session = await auth();
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { groupId } = await params;
        const parsed = RemoveMemberSchema.safeParse(await req.json().catch(() => null));
        if (!parsed.success) {
            return NextResponse.json({ error: 'userId is required' }, { status: 400 });
        }

        const currentUser = await prisma.user.findUnique({ where: { email: session.user.email } });
        if (!currentUser) return NextResponse.json({ error: 'User not found' }, { status: 404 });

        const outcome = await removeMember(currentUser, groupId, parsed.data.userId);
        if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
        return NextResponse.json({
            success: true,
            message: `${outcome.value.name} was removed from the group`,
        });
    } catch (error) {
        logger.error('Remove member error', { err: error });
        return NextResponse.json({ error: 'Failed to remove member' }, { status: 500 });
    }
}
