import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { forgetTokenVersion } from '@/lib/sessionVersion';
import { logger } from '@/lib/logger';

// DELETE /api/me/sessions — "sign out of all devices": ends every session of
// this account, this one included, by raising its tokenVersion
// (src/lib/sessionVersion.ts). A phone left signed in somewhere is signed out
// the next time it asks for anything, within 30 seconds.
export async function DELETE() {
    try {
        const session = await auth();
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const user = await prisma.user.update({
            where: { email: session.user.email },
            data: { tokenVersion: { increment: 1 } },
            select: { id: true },
        });
        forgetTokenVersion(user.id);

        return NextResponse.json({ message: 'Signed out of every device.' });
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
            return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }
        logger.error('Could not sign out of every device', { err: error });
        return NextResponse.json({ error: 'Could not sign out of every device. Please try again.' }, { status: 500 });
    }
}
