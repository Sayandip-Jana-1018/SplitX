import { NextResponse } from 'next/server';
import { readV1Body, v1Error } from '@/lib/apiV1';
import { RefreshRequest } from '@/lib/contract/v1';
import { logger } from '@/lib/logger';
import { endSession } from '@/lib/mobileAuth';

/**
 * POST /api/v1/auth/sign-out: the phone signs out. Its refresh token and every
 * one in its family stop working. Always 204, so it can't be used to test
 * whether a token exists.
 */
export async function POST(request: Request) {
    const body = await readV1Body(request, RefreshRequest);
    if (!body.ok) return body.response;
    try {
        await endSession(body.data.refreshToken);
        return new NextResponse(null, { status: 204 });
    } catch (error) {
        logger.error('Phone sign-out failed', { err: error });
        return v1Error('Couldn’t sign out just now. Try again.', 500, 'server_error');
    }
}
