import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { z } from 'zod';

const InviteSchema = z.object({
    contactId: z.string().min(1),
    groupId: z.string().optional(),
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

        const body = await req.json();
        const parsed = InviteSchema.safeParse(body);
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

        // If a group is specified, include the group invite link
        if (parsed.data.groupId) {
            const group = await prisma.group.findFirst({
                where: { id: parsed.data.groupId },
                select: { inviteCode: true, name: true },
            });
            if (group) {
                inviteUrl = `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/join/${group.inviteCode}`;
            }
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
        console.error('Invite error:', error);
        return NextResponse.json({ error: 'Failed to send invite' }, { status: 500 });
    }
}
