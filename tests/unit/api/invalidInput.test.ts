import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ids, jsonRequest } from '../../helpers/http';

const { auth, prisma } = vi.hoisted(() => ({
    auth: vi.fn(),
    prisma: {
        user: { findUnique: vi.fn(), update: vi.fn() },
        group: { findFirst: vi.fn(), create: vi.fn() },
        trip: { create: vi.fn() },
    },
}));
vi.mock('@/lib/auth', () => ({ auth }));
vi.mock('@/lib/db', () => ({ prisma }));

const trips = await import('@/app/api/trips/route');
const groups = await import('@/app/api/groups/route');
const me = await import('@/app/api/me/route');
const contacts = await import('@/app/api/contacts/route');
const invitations = await import('@/app/api/invitations/route');
const invitation = await import('@/app/api/invitations/[id]/route');

beforeEach(() => {
    auth.mockResolvedValue({ user: { email: 'alice@example.com' } });
    prisma.user.findUnique.mockResolvedValue({ id: ids.alice, name: 'Alice', email: 'alice@example.com' });
});
afterEach(() => vi.resetAllMocks());

const notJson = (url: string, method = 'POST') => new Request(url, { method, headers: { 'content-type': 'application/json' }, body: '{' });

// A page shows `error` as text; the validator's issue objects are neither
// readable there nor anyone else's business.
describe('input that fails validation', () => {
    it.each([
        ['POST /api/trips', () => trips.POST(jsonRequest('http://localhost/api/trips', { groupId: 42 }))],
        ['POST /api/groups', () => groups.POST(jsonRequest('http://localhost/api/groups', { name: '' }))],
        ['PATCH /api/me', () => me.PATCH(jsonRequest('http://localhost/api/me', { name: 'x'.repeat(500) }, { method: 'PATCH' }))],
    ])('%s answers 400 with one sentence naming the field', async (_, send) => {
        const res = await send();

        expect(res.status).toBe(400);
        const { error } = await res.json();
        expect(typeof error).toBe('string');
        expect(error).toMatch(/^Invalid \w+/);
    });

    it.each([
        ['POST /api/trips', () => trips.POST(notJson('http://localhost/api/trips'))],
        ['POST /api/groups', () => groups.POST(notJson('http://localhost/api/groups'))],
        ['PATCH /api/me', () => me.PATCH(notJson('http://localhost/api/me', 'PATCH'))],
        ['POST /api/contacts', () => contacts.POST(notJson('http://localhost/api/contacts'))],
        ['POST /api/invitations', () => invitations.POST(notJson('http://localhost/api/invitations'))],
        ['PATCH /api/invitations/[id]', () => invitation.PATCH(notJson('http://localhost/api/invitations/x', 'PATCH'), { params: Promise.resolve({ id: 'x' }) })],
    ])('%s answers a body that isn’t JSON with 400, not 500', async (_, send) => {
        expect((await send()).status).toBe(400);
    });
});
