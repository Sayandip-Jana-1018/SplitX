import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NotificationList } from '@/lib/contract/v1';
import { prisma } from '@/lib/db';
import { startSession } from '@/lib/mobileAuth';
import { emptyDatabase, groupOf, person } from './fixtures';

const listRoute = await import('@/app/api/v1/notifications/route');
const readRoute = await import('@/app/api/v1/notifications/read/route');

beforeAll(() => {
    process.env.MOBILE_TOKEN_SECRET = 'a-database-test-secret-of-32-characters-or-more';
});
beforeEach(emptyDatabase);
afterAll(() => prisma.$disconnect());

async function headersFor(user: { id: string }) {
    const { accessToken } = await startSession(user.id, { platform: 'android' });
    return { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' };
}
const list = async (user: { id: string }) => NotificationList.parse(await (await listRoute.GET(new Request('https://splitit.test/api/v1/notifications', { headers: await headersFor(user) }))).json());
const read = async (user: { id: string }, body: object) => readRoute.POST(new Request('https://splitit.test/api/v1/notifications/read', { method: 'POST', headers: await headersFor(user), body: JSON.stringify(body) }));

describe('your notifications, from the phone', () => {
    it('lists yours, newest first, with who sent them and how many are unread', async () => {
        const asha = await person('Asha');
        const ravi = await person('Ravi');
        const { group } = await groupOf(asha, [ravi]);
        await prisma.notification.create({ data: { userId: ravi.id, actorId: asha.id, type: 'group_activity', title: 'Asha added an expense', body: '₹600 for lunch', link: `/groups/${group.id}`, createdAt: new Date(Date.now() - 60_000) } });
        await prisma.notification.create({ data: { userId: ravi.id, actorId: asha.id, type: 'payment_reminder', title: 'A reminder', body: 'Pay Asha back', link: '/settlements', read: true } });
        await prisma.notification.create({ data: { userId: asha.id, type: 'group_activity', title: 'Not Ravi’s', body: '', link: null } });

        const mine = await list(ravi);
        expect(mine.unread).toBe(1);
        expect(mine.notifications.map((n) => [n.title, n.read, n.fromName])).toEqual([['A reminder', true, 'Asha'], ['Asha added an expense', false, 'Asha']]);
    });

    it('clears unread ones about a group you have left', async () => {
        const asha = await person('Asha');
        const ravi = await person('Ravi');
        const { group } = await groupOf(asha, []);
        await prisma.notification.create({ data: { userId: ravi.id, type: 'group_activity', title: 'Old news', body: '', link: `/groups/${group.id}` } });
        expect((await list(ravi)).notifications).toEqual([]);
    });

    it('marks some read, or all, and only your own', async () => {
        const asha = await person('Asha');
        const ravi = await person('Ravi');
        const first = await prisma.notification.create({ data: { userId: ravi.id, type: 'payment_reminder', title: 'One', body: '', link: '/settlements' } });
        await prisma.notification.create({ data: { userId: ravi.id, type: 'payment_reminder', title: 'Two', body: '', link: '/settlements' } });
        const hers = await prisma.notification.create({ data: { userId: asha.id, type: 'payment_reminder', title: 'Hers', body: '', link: '/settlements' } });

        expect((await read(ravi, { ids: [first.id, hers.id] })).status).toBe(204);
        expect((await list(ravi)).unread).toBe(1);
        expect((await prisma.notification.findUniqueOrThrow({ where: { id: hers.id } })).read).toBe(false);
        await read(ravi, { all: true });
        expect((await list(ravi)).unread).toBe(0);
    });
});
