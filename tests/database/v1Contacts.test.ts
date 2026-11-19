import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ContactAdded, ContactInviteLink, ContactList, ErrorBody, InvitationAnswered, InvitationList } from '@/lib/contract/v1';
import { prisma } from '@/lib/db';
import { startSession } from '@/lib/mobileAuth';
import { emptyDatabase, groupOf, person } from './fixtures';

const contactsRoute = await import('@/app/api/v1/contacts/route');
const contactRoute = await import('@/app/api/v1/contacts/[id]/route');
const inviteLinkRoute = await import('@/app/api/v1/contacts/[id]/invite/route');
const invitationsRoute = await import('@/app/api/v1/invitations/route');
const invitationRoute = await import('@/app/api/v1/invitations/[id]/route');

beforeAll(() => {
    process.env.MOBILE_TOKEN_SECRET = 'a-database-test-secret-of-32-characters-or-more';
});
beforeEach(emptyDatabase);
afterAll(() => prisma.$disconnect());

async function headersFor(user: { id: string }) {
    const { accessToken } = await startSession(user.id, { platform: 'android' });
    return { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' };
}

const request = async (user: { id: string }, path: string, method = 'GET', body?: unknown) =>
    new Request(`https://splitit.test${path}`, { method, headers: await headersFor(user), body: body === undefined ? undefined : JSON.stringify(body) });
const id = (value: string) => ({ params: Promise.resolve({ id: value }) });

describe('your contacts, from the phone', () => {
    it('adds one, links an email that has an account, refuses a repeat, and lists only yours', async () => {
        const asha = await person('Asha');
        const ravi = await person('Ravi');
        const ravisEmail = (await prisma.user.findUniqueOrThrow({ where: { id: ravi.id } })).email!;

        const added = await contactsRoute.POST(await request(asha, '/api/v1/contacts', 'POST', { name: 'Ravi', email: ravisEmail }));
        expect(added.status).toBe(201);
        expect(ContactAdded.parse(await added.json()).contact).toMatchObject({ name: 'Ravi', userId: ravi.id });

        const notOnApp = ContactAdded.parse(await (await contactsRoute.POST(await request(asha, '/api/v1/contacts', 'POST', { name: 'Kiran', email: 'kiran@elsewhere.test', phone: '+91 98765 43210' }))).json());
        expect(notOnApp.contact).toMatchObject({ userId: null, phone: '+91 98765 43210' });

        const again = await contactsRoute.POST(await request(asha, '/api/v1/contacts', 'POST', { name: 'Ravi again', email: ravisEmail }));
        expect(again.status).toBe(409);
        expect(ErrorBody.parse(await again.json()).code).toBe('exists');

        expect(ContactList.parse(await (await contactsRoute.GET(await request(asha, '/api/v1/contacts'))).json()).contacts.map((c) => c.name)).toEqual(['Kiran', 'Ravi']);
        expect(ContactList.parse(await (await contactsRoute.GET(await request(ravi, '/api/v1/contacts'))).json()).contacts).toEqual([]);
    });

    it('removes one of yours, and nobody else’s', async () => {
        const asha = await person('Asha');
        const ravi = await person('Ravi');
        const { contact } = ContactAdded.parse(await (await contactsRoute.POST(await request(asha, '/api/v1/contacts', 'POST', { name: 'Kiran', email: 'kiran@elsewhere.test' }))).json());
        expect((await contactRoute.DELETE(await request(ravi, `/api/v1/contacts/${contact.id}`, 'DELETE'), id(contact.id))).status).toBe(404);
        expect((await contactRoute.DELETE(await request(asha, `/api/v1/contacts/${contact.id}`, 'DELETE'), id(contact.id))).status).toBe(204);
        expect(await prisma.contact.count()).toBe(0);
    });

    it('makes a link to send them: to sign up, or to join a group of yours only', async () => {
        const asha = await person('Asha');
        const ravi = await person('Ravi');
        const { group } = await groupOf(asha, []);
        const { group: notMine } = await groupOf(ravi, []);
        const { contact } = ContactAdded.parse(await (await contactsRoute.POST(await request(asha, '/api/v1/contacts', 'POST', { name: 'Kiran', email: 'kiran@elsewhere.test' }))).json());

        const signUp = ContactInviteLink.parse(await (await inviteLinkRoute.POST(await request(asha, `/api/v1/contacts/${contact.id}/invite`, 'POST', {}), id(contact.id))).json());
        expect(signUp.url).toMatch(/\/register$/);
        expect(signUp.message).toContain('Kiran');
        const join = ContactInviteLink.parse(await (await inviteLinkRoute.POST(await request(asha, `/api/v1/contacts/${contact.id}/invite`, 'POST', { groupId: group.id }), id(contact.id))).json());
        expect(join.url).toMatch(/\/join\/[\w-]+$/);
        expect((await inviteLinkRoute.POST(await request(asha, `/api/v1/contacts/${contact.id}/invite`, 'POST', { groupId: notMine.id }), id(contact.id))).status).toBe(404);
    });
});

describe('invitations into a group', () => {
    it('invites someone, who sees it, accepts, and is in the group; the inviter is told', async () => {
        const asha = await person('Asha');
        const ravi = await person('Ravi');
        const { group } = await groupOf(asha, []);

        expect((await invitationsRoute.POST(await request(asha, '/api/v1/invitations', 'POST', { groupId: group.id, inviteeId: ravi.id }))).status).toBe(204);
        const twice = await invitationsRoute.POST(await request(asha, '/api/v1/invitations', 'POST', { groupId: group.id, inviteeId: ravi.id }));
        expect(ErrorBody.parse(await twice.json()).code).toBe('already_invited');

        const { invitations } = InvitationList.parse(await (await invitationsRoute.GET(await request(ravi, '/api/v1/invitations'))).json());
        expect(invitations).toEqual([expect.objectContaining({ groupId: group.id, groupName: 'Goa', fromName: 'Asha' })]);

        const answer = await invitationRoute.POST(await request(ravi, `/api/v1/invitations/${invitations[0].id}`, 'POST', { accept: true }), id(invitations[0].id));
        expect(InvitationAnswered.parse(await answer.json())).toEqual({ status: 'accepted', groupId: group.id });
        expect(await prisma.groupMember.count({ where: { groupId: group.id, userId: ravi.id } })).toBe(1);
        expect(await prisma.notification.count({ where: { userId: asha.id, type: 'group_invite_accepted' } })).toBe(1);
        expect(InvitationList.parse(await (await invitationsRoute.GET(await request(ravi, '/api/v1/invitations'))).json()).invitations).toEqual([]);
    });

    it('lets only the invitee answer, and nobody join a group deleted since', async () => {
        const asha = await person('Asha');
        const ravi = await person('Ravi');
        const meera = await person('Meera');
        const { group } = await groupOf(asha, []);
        await invitationsRoute.POST(await request(asha, '/api/v1/invitations', 'POST', { groupId: group.id, inviteeId: ravi.id }));
        const invitation = await prisma.groupInvitation.findFirstOrThrow();

        expect((await invitationRoute.POST(await request(meera, `/api/v1/invitations/${invitation.id}`, 'POST', { accept: true }), id(invitation.id))).status).toBe(403);
        await prisma.group.update({ where: { id: group.id }, data: { deletedAt: new Date() } });
        expect(InvitationList.parse(await (await invitationsRoute.GET(await request(ravi, '/api/v1/invitations'))).json()).invitations).toEqual([]);
        const late = await invitationRoute.POST(await request(ravi, `/api/v1/invitations/${invitation.id}`, 'POST', { accept: true }), id(invitation.id));
        expect(ErrorBody.parse(await late.json()).code).toBe('group_deleted');
        expect(await prisma.groupMember.count({ where: { groupId: group.id, userId: ravi.id } })).toBe(0);
    });

    it('refuses an invitation from outside the group, and to someone already in it', async () => {
        const asha = await person('Asha');
        const ravi = await person('Ravi');
        const meera = await person('Meera');
        const { group } = await groupOf(asha, [ravi]);
        expect((await invitationsRoute.POST(await request(meera, '/api/v1/invitations', 'POST', { groupId: group.id, inviteeId: meera.id }))).status).toBe(403);
        const already = await invitationsRoute.POST(await request(asha, '/api/v1/invitations', 'POST', { groupId: group.id, inviteeId: ravi.id }));
        expect(ErrorBody.parse(await already.json()).code).toBe('already_member');
    });
});
