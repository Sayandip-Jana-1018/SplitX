import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { addContact, listContacts, removeContact } from '@/lib/services/contacts';

// The rules live in src/lib/services/contacts.ts, shared with the phone app's /api/v1/contacts.

const CreateContactSchema = z.object({
    name: z.string().min(1, 'Name is required').max(100),
    email: z.string().email('Invalid email address'),
    phone: z.string().optional(),
});

// GET /api/contacts — list contacts for current user
export async function GET() {
    try {
        const session = await auth();
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const user = await prisma.user.findUnique({ where: { email: session.user.email } });
        if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

        return NextResponse.json(await listContacts(user.id));
    } catch (error) {
        logger.error('Contacts fetch error', { err: error });
        return NextResponse.json({ error: 'Failed to fetch contacts' }, { status: 500 });
    }
}

// POST /api/contacts — add a new contact
export async function POST(req: Request) {
    try {
        const session = await auth();
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const user = await prisma.user.findUnique({ where: { email: session.user.email } });
        if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

        const parsed = CreateContactSchema.safeParse(await req.json().catch(() => null));
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
        }

        const outcome = await addContact(user.id, parsed.data);
        if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
        return NextResponse.json(outcome.value, { status: 201 });
    } catch (error) {
        logger.error('Contact create error', { err: error });
        return NextResponse.json({ error: 'Failed to create contact' }, { status: 500 });
    }
}

// DELETE /api/contacts — delete a contact by id (passed as query param)
export async function DELETE(req: Request) {
    try {
        const session = await auth();
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const user = await prisma.user.findUnique({ where: { email: session.user.email } });
        if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

        const contactId = new URL(req.url).searchParams.get('id');
        if (!contactId) {
            return NextResponse.json({ error: 'Contact ID required' }, { status: 400 });
        }

        const outcome = await removeContact(user.id, contactId);
        if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
        return NextResponse.json({ success: true });
    } catch (error) {
        logger.error('Contact delete error', { err: error });
        return NextResponse.json({ error: 'Failed to delete contact' }, { status: 500 });
    }
}
