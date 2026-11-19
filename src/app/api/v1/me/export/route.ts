import { requireCaller, v1Error, v1Json } from '@/lib/apiV1';
import { logger } from '@/lib/logger';
import { exportAccount } from '@/lib/services/account';

/** GET /api/v1/me/export: everything the app holds about you, as one JSON document (the website's export). */
export async function GET(request: Request) {
    const auth = await requireCaller(request);
    if (!auth.ok) return auth.response;
    try {
        const data = await exportAccount(auth.caller.userId);
        return data ? v1Json(data) : v1Error('Your session has ended. Sign in again.', 401, 'unauthenticated');
    } catch (error) {
        logger.error('Phone data export failed', { err: error });
        return v1Error('Couldn’t gather your data. Try again.', 500, 'server_error');
    }
}
