import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { exportAccount } from '@/lib/services/account';

// GET /api/me/export — everything the app holds about you, as JSON (src/lib/services/account.ts,
// shared with the phone app's GET /api/v1/me/export).
export async function GET() {
    try {
        const session = await auth();
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const me = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } });
        const data = me ? await exportAccount(me.id) : null;
        if (!data) {
            return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }
        return NextResponse.json(data);
    } catch (error) {
        logger.error('Export my data error', { err: error });
        return NextResponse.json({ error: 'Failed to export data' }, { status: 500 });
    }
}
