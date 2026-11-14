import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { joinGroup } from '@/lib/services/groups';
import { inviteIsLive } from '@/lib/groupInvite';

const JoinGroupSchema = z.object({
    inviteCode: z.string().trim().min(1).max(64),
});

// A link works for 7 days (lib/groupInvite.ts). 410: this code was real, and is no more.
const expired = () => NextResponse.json(
    { error: 'This invite link has expired. Ask someone in the group for a new one.' },
    { status: 410 }
);

// POST /api/groups/join — join a group by invite code
export async function POST(req: Request) {
    try {
        const session = await auth();
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const parsed = JoinGroupSchema.safeParse(await req.json().catch(() => null));
        if (!parsed.success) {
            return NextResponse.json({ error: 'Valid invite code is required' }, { status: 400 });
        }

        const user = await prisma.user.findUnique({ where: { email: session.user.email } });
        if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

        const outcome = await joinGroup(user, parsed.data.inviteCode);
        if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
        if (!outcome.value.joined) return NextResponse.json({ message: 'Already a member', groupId: outcome.value.groupId });
        return NextResponse.json({ message: 'Joined successfully', groupId: outcome.value.groupId }, { status: 201 });
    } catch (error) {
        logger.error('Join group error', { err: error });
        return NextResponse.json({ error: 'Failed to join group' }, { status: 500 });
    }
}

// GET /api/groups/join?code=xxx — get group info by invite code (for preview)
export async function GET(req: Request) {
    try {
        const { searchParams } = new URL(req.url);
        const code = searchParams.get('code');
        if (!code) {
            return NextResponse.json({ error: 'code param required' }, { status: 400 });
        }

        const group = await prisma.group.findFirst({
            where: { inviteCode: code, deletedAt: null },
            select: {
                id: true,
                name: true,
                emoji: true,
                inviteCodeIssuedAt: true,
                _count: { select: { members: true } },
            },
        });

        if (!group) {
            return NextResponse.json({ error: 'Invalid invite code' }, { status: 404 });
        }
        // An expired link shows nothing of the group, not even its name.
        const { inviteCodeIssuedAt, ...preview } = group;
        if (!inviteIsLive(inviteCodeIssuedAt)) return expired();

        return NextResponse.json(preview);
    } catch (error) {
        logger.error('Failed to look up group', { err: error });
        return NextResponse.json({ error: 'Failed to look up group' }, { status: 500 });
    }
}
