import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { inviteLink } from '@/lib/services/groups';

// POST /api/groups/:groupId/invite — a link that works (D-112). The owner or an
// admin always gets a new one, which ends the old one. Anyone else in the group
// renews an expired link, and is given back one that still works.
export async function POST(
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

        const link = await inviteLink(user.id, groupId, { adminMakesNew: true });
        if (!link) return NextResponse.json({ error: 'Group not found' }, { status: 404 });
        return NextResponse.json(link);
    } catch (error) {
        logger.error('Invite link error', { err: error });
        return NextResponse.json({ error: 'Could not make a new link' }, { status: 500 });
    }
}
