import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { z } from 'zod';
import { logger } from '@/lib/logger';

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

        const contacts = await prisma.contact.findMany({
            where: { ownerId: user.id },
            include: {
                linkedUser: {
                    select: { id: true, name: true, image: true, email: true },
                },
            },
            orderBy: { addedAt: 'desc' },
        });

        return NextResponse.json(contacts);
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

        // Check for duplicate
        const existing = await prisma.contact.findUnique({
            where: { ownerId_email: { ownerId: user.id, email: parsed.data.email } },
        });
        if (existing) {
            return NextResponse.json({ error: 'Contact already exists' }, { status: 409 });
        }

        // Check if this email belongs to a registered user
        const linkedUser = await prisma.user.findUnique({
            where: { email: parsed.data.email },
            select: { id: true },
        });

        const contact = await prisma.contact.create({
            data: {
                ownerId: user.id,
                name: parsed.data.name,
                email: parsed.data.email,
                phone: parsed.data.phone || null,
                linkedUserId: linkedUser?.id || null,
            },
            include: {
                linkedUser: {
                    select: { id: true, name: true, image: true, email: true },
                },
            },
        });

        return NextResponse.json(contact, { status: 201 });
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

        const { searchParams } = new URL(req.url);
        const contactId = searchParams.get('id');
        if (!contactId) {
            return NextResponse.json({ error: 'Contact ID required' }, { status: 400 });
        }

        // Verify ownership
        const contact = await prisma.contact.findFirst({
            where: { id: contactId, ownerId: user.id },
        });
        if (!contact) {
            return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
        }

        await prisma.contact.delete({ where: { id: contactId } });

        return NextResponse.json({ success: true });
    } catch (error) {
        logger.error('Contact delete error', { err: error });
        return NextResponse.json({ error: 'Failed to delete contact' }, { status: 500 });
    }
}
