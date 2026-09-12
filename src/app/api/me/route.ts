import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { z } from 'zod';
import { logger } from '@/lib/logger';

// GET /api/me — returns current authenticated user
export async function GET() {
    try {
        const session = await auth();
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        let user = await prisma.user.findUnique({
            where: { email: session.user.email },
            select: {
                id: true,
                name: true,
                email: true,
                image: true,
                phone: true,
                upiId: true,
                createdAt: true,
            },
        });

        if (!user) {
            return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }

        // Auto-sync: if session has image/name but DB doesn't, persist it
        // This fixes cases where DB was unreachable during OAuth sign-in
        const needsSync: Record<string, string> = {};
        if (!user.image && session.user.image) needsSync.image = session.user.image;
        if (!user.name && session.user.name) needsSync.name = session.user.name;

        if (Object.keys(needsSync).length > 0) {
            try {
                user = await prisma.user.update({
                    where: { email: session.user.email },
                    data: needsSync,
                    select: {
                        id: true,
                        name: true,
                        email: true,
                        image: true,
                        phone: true,
                        upiId: true,
                        createdAt: true,
                    },
                });
            } catch {
                // If sync fails, return existing data — not critical
            }
        }

        return NextResponse.json(user);
    } catch (error) {
        logger.error('Failed to fetch user', { err: error });
        return NextResponse.json({ error: 'Failed to fetch user' }, { status: 500 });
    }
}

const UpdateProfileSchema = z.object({
    name: z.string().min(1).max(100).optional(),
    phone: z.string().max(20).regex(/^[+]?\d[\d\s-]{6,18}$/, 'Invalid phone number').optional().or(z.literal('')),
    upiId: z.string().max(100).regex(/^[\w.-]+@[\w]+$/, 'Invalid UPI ID format (e.g. name@bank)').optional().or(z.literal('')),
    image: z.string().max(2000).optional(),
});

// PATCH /api/me — update current user's profile
export async function PATCH(req: Request) {
    try {
        const session = await auth();
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await req.json();
        const parsed = UpdateProfileSchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
        }

        const updateData: Record<string, string> = {};
        if (parsed.data.name) updateData.name = parsed.data.name;
        if (parsed.data.phone !== undefined) updateData.phone = parsed.data.phone;
        if (parsed.data.upiId !== undefined) updateData.upiId = parsed.data.upiId;
        if (parsed.data.image !== undefined) updateData.image = parsed.data.image;

        const user = await prisma.user.update({
            where: { email: session.user.email },
            data: updateData,
            select: {
                id: true,
                name: true,
                email: true,
                image: true,
                phone: true,
                upiId: true,
                createdAt: true,
            },
        });

        return NextResponse.json(user);
    } catch (error) {
        logger.error('Failed to update profile', { err: error });
        return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 });
    }
}

// DELETE /api/me — permanently delete user account and all associated data
export async function DELETE() {
    try {
        const session = await auth();
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const user = await prisma.user.findUnique({ where: { email: session.user.email } });
        if (!user) {
            return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }

        await prisma.$transaction(async (tx) => {
            // Delete notifications (as recipient and actor)
            await tx.notification.deleteMany({ where: { userId: user.id } });
            await tx.notification.deleteMany({ where: { actorId: user.id } });

            // Delete contacts (Contact model uses ownerId instead of userId)
            await tx.contact.deleteMany({ where: { ownerId: user.id } });

            // Delete budgets
            await tx.budget.deleteMany({ where: { userId: user.id } });

            // Delete group memberships
            await tx.groupMember.deleteMany({ where: { userId: user.id } });

            // Delete sessions and accounts (NextAuth)
            await tx.session.deleteMany({ where: { userId: user.id } });
            await tx.account.deleteMany({ where: { userId: user.id } });

            // Soft-delete groups owned by user
            await tx.group.updateMany({
                where: { ownerId: user.id },
                data: { deletedAt: new Date() },
            });

            // Delete the user
            await tx.user.delete({ where: { id: user.id } });
        });

        return NextResponse.json({ message: 'Account deleted successfully' });
    } catch (error) {
        logger.error('Account deletion error', { err: error });
        return NextResponse.json({ error: 'Failed to delete account' }, { status: 500 });
    }
}
