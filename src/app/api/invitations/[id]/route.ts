import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { answerInvitation } from '@/lib/services/contacts';

const ActionSchema = z.object({
    status: z.enum(['accepted', 'declined']),
});

/**
 * PATCH /api/invitations/[id] — accept or decline an invitation (rules: src/lib/services/contacts.ts)
 */
export async function PATCH(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const session = await auth();
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const user = await prisma.user.findUnique({ where: { email: session.user.email } });
        if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

        const { id } = await params;
        const parsed = ActionSchema.safeParse(await req.json().catch(() => null));
        if (!parsed.success) {
            return NextResponse.json({ error: 'status must be "accepted" or "declined"' }, { status: 400 });
        }

        const outcome = await answerInvitation(user, id, parsed.data.status);
        if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
        return NextResponse.json({ success: true, ...outcome.value });
    } catch (error) {
        logger.error('Invitation action error', { err: error });
        return NextResponse.json({ error: 'Failed to process invitation' }, { status: 500 });
    }
}
