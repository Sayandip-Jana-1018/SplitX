import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { z } from 'zod';

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
        return NextResponse.json({ error: 'Failed to fetch user' }, { status: 500 });
    }
}

const UpdateProfileSchema = z.object({
    name: z.string().min(1).max(100).optional(),
    phone: z.string().max(20).optional(),
    upiId: z.string().max(100).optional(),
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
        return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 });
    }
}
