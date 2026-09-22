import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { z } from 'zod';
import { logger } from '@/lib/logger';

const InviteSchema = z.object({
    contactId: z.string().min(1).max(64),
    groupId: z.string().min(1).max(64).optional(),
});

// POST /api/contacts/invite — send an invite to a contact
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
            return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
        }

        // Get the contact
        const contact = await prisma.contact.findFirst({
            where: { id: parsed.data.contactId, ownerId: user.id },
        });
        if (!contact) {
            return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
        }

        // Build the invite URL
        let inviteUrl = `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/register`;

        // A group's invite link goes only to its own members: anyone holding the
        // code can join. This used to answer for any group ID it was given.
        if (parsed.data.groupId) {
            const group = await prisma.group.findFirst({
                where: {
                    id: parsed.data.groupId,
                    deletedAt: null,
                    OR: [{ ownerId: user.id }, { members: { some: { userId: user.id } } }],
                },
                select: { inviteCode: true },
            });
            if (!group) {
                return NextResponse.json({ error: 'Group not found' }, { status: 404 });
            }
            inviteUrl = `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/join/${group.inviteCode}`;
        }

        // For now, return the invite URL — in production you'd use SendGrid/Resend/etc.
        // The frontend will use the native share API to send via mail/message
        return NextResponse.json({
            success: true,
            inviteUrl,
            contactEmail: contact.email,
            contactName: contact.name,
            message: `Hey ${contact.name}! Join me on SplitX to split expenses easily. Click here: ${inviteUrl}`,
        });
    } catch (error) {
        logger.error('Invite error', { err: error });
        return NextResponse.json({ error: 'Failed to send invite' }, { status: 500 });
    }
}
