import { NextResponse } from 'next/server';
import { DeletionRefused } from '@/lib/accountDeletion';
import { meOf, readV1Body, requireCaller, v1Error, v1Json } from '@/lib/apiV1';
import { ProfileUpdate } from '@/lib/contract/v1';
import { logger } from '@/lib/logger';
import { closeAccount } from '@/lib/services/account';
import { updateProfile } from '@/lib/v1/auth';

/** GET /api/v1/me: the signed-in account, as the app shows it. */
export async function GET(request: Request) {
    const auth = await requireCaller(request);
    if (!auth.ok) return auth.response;
    const me = await meOf(auth.caller.userId);
    return me ? v1Json({ me }) : v1Error('Your session has ended. Sign in again.', 401, 'unauthenticated');
}

/** PATCH /api/v1/me: your name and UPI ID, by the website's profile rules. */
export async function PATCH(request: Request) {
    const auth = await requireCaller(request);
    if (!auth.ok) return auth.response;
    const body = await readV1Body(request, ProfileUpdate);
    if (!body.ok) return body.response;
    const me = await updateProfile(auth.caller.userId, body.data);
    return me ? v1Json({ me }) : v1Error('Your session has ended. Sign in again.', 401, 'unauthenticated');
}

/**
 * DELETE /api/v1/me: closes your account by the website's rules (src/lib/accountDeletion.ts):
 * refused with why while you owe or are owed (409, "not_settled"). Every session ends, this one too.
 */
export async function DELETE(request: Request) {
    const auth = await requireCaller(request);
    if (!auth.ok) return auth.response;
    try {
        await closeAccount(auth.caller.userId);
        return new NextResponse(null, { status: 204 });
    } catch (error) {
        if (error instanceof DeletionRefused) return v1Error(error.message, error.status, error.status === 404 ? 'not_found' : 'not_settled');
        logger.error('Phone account deletion failed', { err: error });
        return v1Error('Couldn’t delete your account. Try again.', 500, 'server_error');
    }
}
