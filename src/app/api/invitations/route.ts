import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { inviteToGroup, pendingInvitations } from '@/lib/services/contacts';

const InviteSchema = z.object({
    groupId: z.string().min(1),
    inviteeId: z.string().min(1),
});

/**
 * POST /api/invitations — send a group invitation to a user (rules: src/lib/services/contacts.ts)
 */
export async function POST(req: Request) {
    try {
        const session = await auth();
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const user = await prisma.user.findUnique({ where: { email: session.user.email } });
        if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

        const parsed = InviteSchema.safeParse(await req.json().catch(() => null));
        if (!parsed.success) {
            return NextResponse.json({ error: 'groupId and inviteeId are required' }, { status: 400 });
        }

        const outcome = await inviteToGroup(user, parsed.data.groupId, parsed.data.inviteeId);
        if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
        return NextResponse.json({ success: true, invitation: outcome.value }, { status: 201 });
    } catch (error) {
        logger.error('Create invitation error', { err: error });
        return NextResponse.json({ error: 'Failed to send invitation' }, { status: 500 });
    }
}

/**
 * GET /api/invitations — list pending invitations for the current user
 */
export async function GET() {
    try {
        const session = await auth();
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const user = await prisma.user.findUnique({ where: { email: session.user.email } });
        if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

        return NextResponse.json(await pendingInvitations(user.id));
    } catch (error) {
        logger.error('List invitations error', { err: error });
        return NextResponse.json({ error: 'Failed to fetch invitations' }, { status: 500 });
    }
}
