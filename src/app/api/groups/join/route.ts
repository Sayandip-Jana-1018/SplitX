import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { z } from 'zod';

const JoinGroupSchema = z.object({
    inviteCode: z.string().min(1),
});

// POST /api/groups/join — join a group by invite code
export async function POST(req: Request) {
    try {
        const session = await auth();
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await req.json();
        const parsed = JoinGroupSchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json({ error: 'Valid invite code is required' }, { status: 400 });
        }

        const user = await prisma.user.findUnique({ where: { email: session.user.email } });
        if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

        // Find group by invite code
        const group = await prisma.group.findUnique({
            where: { inviteCode: parsed.data.inviteCode },
            include: {
                members: { select: { userId: true } },
            },
        });

        if (!group) {
            return NextResponse.json({ error: 'Invalid invite code' }, { status: 404 });
        }

        // Check if already a member
        const isMember = group.members.some(m => m.userId === user.id);
        if (isMember) {
            return NextResponse.json({
                message: 'Already a member',
                groupId: group.id,
            });
        }

        // Add user as member
        await prisma.groupMember.create({
            data: {
                groupId: group.id,
                userId: user.id,
                role: 'member',
            },
        });

        // Notify all existing members about the new joiner
        const existingMemberIds = group.members
            .map(m => m.userId)
            .filter(id => id !== user.id);

        if (existingMemberIds.length > 0) {
            const joinerName = user.name || user.email?.split('@')[0] || 'Someone';
            await prisma.notification.createMany({
                data: existingMemberIds.map(memberId => ({
                    userId: memberId,
                    type: 'member_joined',
                    title: 'New member joined',
                    body: `${joinerName} joined "${group.name}"`,
                    link: `/groups/${group.id}`,
                })),
            });
        }

        return NextResponse.json({
            message: 'Joined successfully',
            groupId: group.id,
        }, { status: 201 });
    } catch (error) {
        console.error('Join group error:', error);
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

        const group = await prisma.group.findUnique({
            where: { inviteCode: code },
            select: {
                id: true,
                name: true,
                emoji: true,
                _count: { select: { members: true } },
            },
        });

        if (!group) {
            return NextResponse.json({ error: 'Invalid invite code' }, { status: 404 });
        }

        return NextResponse.json(group);
    } catch (error) {
        return NextResponse.json({ error: 'Failed to look up group' }, { status: 500 });
    }
}
