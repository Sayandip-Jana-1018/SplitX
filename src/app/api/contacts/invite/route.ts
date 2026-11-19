import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { contactInvite } from '@/lib/services/contacts';
import { siteUrl } from '@/lib/siteUrl';

const InviteSchema = z.object({
    contactId: z.string().min(1).max(64),
    groupId: z.string().min(1).max(64).optional(),
});

// POST /api/contacts/invite — a link and message to send a contact (to sign up, or to join one of
// your groups); the page shares it. The rules live in src/lib/services/contacts.ts.
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

        // The site's public address, never a localhost fallback.
        const outcome = await contactInvite(user.id, parsed.data.contactId, parsed.data.groupId, siteUrl(req) ?? new URL(req.url).origin);
        if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
        return NextResponse.json({
            success: true,
            inviteUrl: outcome.value.url,
            contactEmail: outcome.value.email,
            contactName: outcome.value.name,
            message: outcome.value.message,
        });
    } catch (error) {
        logger.error('Invite error', { err: error });
        return NextResponse.json({ error: 'Failed to send invite' }, { status: 500 });
    }
}
