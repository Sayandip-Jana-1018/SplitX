import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { invalidInput } from '@/lib/invalidInput';
import { deleteAccount, DeletionRefused } from '@/lib/accountDeletion';
import { forgetTokenVersion } from '@/lib/sessionVersion';
import { removeAvatars } from '@/lib/storage';
import { RECEIPTS_BUCKET } from '@/lib/receiptUrl';

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

// No `image`: a profile photo is shown to everyone in your groups, so it comes
// only from an upload to SplitX's storage (/api/me/avatar) or from Google or
// GitHub at sign-in, never from a URL anyone types (a tracking pixel, say).
const UpdateProfileSchema = z.object({
    name: z.string().min(1).max(100).optional(),
    phone: z.string().max(20).regex(/^[+]?\d[\d\s-]{6,18}$/, 'Invalid phone number').optional().or(z.literal('')),
    upiId: z.string().max(100).regex(/^[\w.-]+@[\w]+$/, 'Invalid UPI ID format (e.g. name@bank)').optional().or(z.literal('')),
});

// PATCH /api/me — update current user's profile
export async function PATCH(req: Request) {
    try {
        const session = await auth();
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const parsed = UpdateProfileSchema.safeParse(await req.json().catch(() => null));
        if (!parsed.success) return invalidInput(parsed.error);

        const updateData: Record<string, string> = {};
        if (parsed.data.name) updateData.name = parsed.data.name;
        if (parsed.data.phone !== undefined) updateData.phone = parsed.data.phone;
        if (parsed.data.upiId !== undefined) updateData.upiId = parsed.data.upiId;

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

// DELETE /api/me — deletes the account the way src/lib/accountDeletion.ts
// describes: refused while money is open, the person erased from a history that
// stays whole, every session ended. Then their profile photos are removed.
export async function DELETE() {
    try {
        const session = await auth();
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } });
        if (!user) {
            return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }

        const outcome = await deleteAccount(user.id);
        forgetTokenVersion(user.id);

        try {
            await removeAvatars(user.id, RECEIPTS_BUCKET);
        } catch (error) {
            // The account is gone either way; a photo left behind is logged to clear by hand.
            logger.warn('Could not remove the profile photos of a deleted account', { err: error });
        }

        return NextResponse.json({ message: 'Your account was deleted.', ...outcome });
    } catch (error) {
        if (error instanceof DeletionRefused) {
            return NextResponse.json({ error: error.message }, { status: error.status });
        }
        logger.error('Account deletion error', { err: error });
        return NextResponse.json({ error: 'Failed to delete account' }, { status: 500 });
    }
}
