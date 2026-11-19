import { NextResponse } from 'next/server';
import { requireCaller, v1Error } from '@/lib/apiV1';
import { logger } from '@/lib/logger';
import { removeContact } from '@/lib/services/contacts';

/** DELETE /api/v1/contacts/:id: removes one of your contacts. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const auth = await requireCaller(request);
    if (!auth.ok) return auth.response;
    const { id } = await params;
    try {
        const outcome = await removeContact(auth.caller.userId, id);
        return outcome.ok ? new NextResponse(null, { status: 204 }) : v1Error(outcome.error, outcome.status, outcome.code);
    } catch (error) {
        logger.error('Phone contact removal failed', { err: error });
        return v1Error('Couldn’t remove them. Try again.', 500, 'server_error');
    }
}
