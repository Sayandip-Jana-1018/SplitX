import { z } from 'zod';
import { readV1Body, requireCaller, v1Error, v1Json } from '@/lib/apiV1';
import { NewMessage } from '@/lib/contract/v1';
import { logger } from '@/lib/logger';
import { postMessage, readMessages } from '@/lib/v1/writes';

const PageQuery = z.object({ cursor: z.string().max(64).optional(), limit: z.coerce.number().int().min(1).max(50).default(30) });

type Params = { params: Promise<{ groupId: string }> };

/** GET /api/v1/groups/:groupId/messages?cursor=&limit=: the chat, oldest first, ending at the newest. */
export async function GET(request: Request, { params }: Params) {
    const auth = await requireCaller(request);
    if (!auth.ok) return auth.response;
    const query = PageQuery.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!query.success) return v1Error('That chat request isn’t valid.', 400, 'invalid_input');
    const { groupId } = await params;
    try {
        const page = await readMessages(auth.caller.userId, groupId, query.data);
        return page ? v1Json(page) : v1Error('That group isn’t here.', 404, 'not_found');
    } catch (error) {
        logger.error('Phone chat read failed', { err: error });
        return v1Error('Couldn’t load the chat. Try again.', 500, 'server_error');
    }
}

/** POST /api/v1/groups/:groupId/messages: sends a message (at most 5 in 10 seconds). */
export async function POST(request: Request, { params }: Params) {
    const auth = await requireCaller(request);
    if (!auth.ok) return auth.response;
    const body = await readV1Body(request, NewMessage);
    if (!body.ok) return body.response;
    const { groupId } = await params;
    try {
        const outcome = await postMessage(auth.caller.userId, groupId, body.data);
        return outcome.ok ? v1Json(outcome.value, 201) : v1Error(outcome.error, outcome.status, outcome.code);
    } catch (error) {
        logger.error('Phone chat send failed', { err: error });
        return v1Error('Couldn’t send that message. It’s kept on your phone.', 500, 'server_error');
    }
}
