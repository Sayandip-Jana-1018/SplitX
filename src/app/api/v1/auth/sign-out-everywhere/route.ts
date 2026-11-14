import { NextResponse } from 'next/server';
import { requireCaller, v1Error } from '@/lib/apiV1';
import { logger } from '@/lib/logger';
import { signOutEverywhere } from '@/lib/v1/auth';

/** POST /api/v1/auth/sign-out-everywhere: ends every session of the account, on every phone and browser, this one included. */
export async function POST(request: Request) {
    const auth = await requireCaller(request);
    if (!auth.ok) return auth.response;
    try {
        await signOutEverywhere(auth.caller.userId);
        return new NextResponse(null, { status: 204 });
    } catch (error) {
        logger.error('Phone sign-out everywhere failed', { err: error });
        return v1Error('Couldn’t sign out everywhere just now. Try again.', 500, 'server_error');
    }
}
