import { readV1Body, requireCaller, v1Error, v1Json } from '@/lib/apiV1';
import { NewContact, type ContactAdded, type ContactList } from '@/lib/contract/v1';
import { logger } from '@/lib/logger';
import { addContact, listContacts } from '@/lib/services/contacts';
import { contactOf } from '@/lib/v1/contacts';

/** GET /api/v1/contacts: your contacts, newest first. */
export async function GET(request: Request) {
    const auth = await requireCaller(request);
    if (!auth.ok) return auth.response;
    try {
        const answer: ContactList = { contacts: (await listContacts(auth.caller.userId)).map(contactOf) };
        return v1Json(answer);
    } catch (error) {
        logger.error('Phone contacts read failed', { err: error });
        return v1Error('Couldn’t load your contacts. Try again.', 500, 'server_error');
    }
}

/** POST /api/v1/contacts: adds one; an email you already have is refused (409, "exists"). */
export async function POST(request: Request) {
    const auth = await requireCaller(request);
    if (!auth.ok) return auth.response;
    const body = await readV1Body(request, NewContact);
    if (!body.ok) return body.response;
    try {
        const outcome = await addContact(auth.caller.userId, body.data);
        if (!outcome.ok) return v1Error('That email is already one of your contacts.', outcome.status, outcome.code);
        const answer: ContactAdded = { contact: contactOf(outcome.value) };
        return v1Json(answer, 201);
    } catch (error) {
        logger.error('Phone contact add failed', { err: error });
        return v1Error('Couldn’t add them. Try again.', 500, 'server_error');
    }
}
