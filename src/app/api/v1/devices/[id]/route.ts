import { NextResponse } from 'next/server';
import { requireCaller, v1Error } from '@/lib/apiV1';
import { logger } from '@/lib/logger';
import { forgetDevice } from '@/lib/services/account';

/** DELETE /api/v1/devices/:id: signs one of your other phones out and forgets it. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const auth = await requireCaller(request);
    if (!auth.ok) return auth.response;
    const { id } = await params;
    try {
        const outcome = await forgetDevice(auth.caller.userId, id, auth.caller.deviceId);
        return outcome.ok ? new NextResponse(null, { status: 204 }) : v1Error(outcome.error, outcome.status, outcome.code);
    } catch (error) {
        logger.error('Phone device sign-out failed', { err: error });
        return v1Error('Couldn’t sign that phone out. Try again.', 500, 'server_error');
    }
}
