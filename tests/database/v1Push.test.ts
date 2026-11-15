import { generateKeyPairSync } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { startSession } from '@/lib/mobileAuth';
import { forgetPushAccess, sendPush } from '@/lib/push';
import { emptyDatabase, groupOf, person } from './fixtures';

const pushTokenRoute = await import('@/app/api/v1/devices/push-token/route');
const signOutRoute = await import('@/app/api/v1/auth/sign-out/route');
const everywhereRoute = await import('@/app/api/v1/auth/sign-out-everywhere/route');
const expensesRoute = await import('@/app/api/v1/expenses/route');

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const SERVICE_ACCOUNT = JSON.stringify({ project_id: 'splitit-test', client_email: 'push@splitit-test.iam.gserviceaccount.com', private_key: privateKey });
const TOKEN = (n: number) => `fcm-token-${n}:APA91b${'x'.repeat(40)}`;

/** Google, faked: the OAuth token endpoint, and FCM, which refuses tokens listed in `gone`. */
const sent: { token: string; title: string; link?: string }[] = [];
const gone = new Set<string>();
function fakeGoogle() {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
        if (url === 'https://oauth2.googleapis.com/token') return new Response(JSON.stringify({ access_token: 'ya29.test', expires_in: 3600 }), { status: 200 });
        if (url.startsWith('https://fcm.googleapis.com/v1/projects/splitit-test/messages:send')) {
            const { message } = JSON.parse(String(init.body));
            if (gone.has(message.token)) return new Response(JSON.stringify({ error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } }), { status: 404 });
            sent.push({ token: message.token, title: message.notification.title, link: message.data.link });
            return new Response(JSON.stringify({ name: 'projects/splitit-test/messages/1' }), { status: 200 });
        }
        throw new Error('unexpected fetch ' + url);
    }));
}

beforeAll(() => {
    process.env.MOBILE_TOKEN_SECRET = 'a-database-test-secret-of-32-characters-or-more';
});
beforeEach(async () => {
    await emptyDatabase();
    sent.length = 0;
    gone.clear();
    forgetPushAccess();
    vi.stubEnv('FIREBASE_SERVICE_ACCOUNT', SERVICE_ACCOUNT);
    fakeGoogle();
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
});
afterAll(() => prisma.$disconnect());

async function signedInPhone(user: { id: string }, token?: string) {
    const session = await startSession(user.id, { platform: 'android' });
    const headers = { authorization: `Bearer ${session.accessToken}`, 'content-type': 'application/json' };
    if (token) {
        const answer = await pushTokenRoute.PUT(new Request('https://splitit.test/api/v1/devices/push-token', { method: 'PUT', headers, body: JSON.stringify({ token }) }));
        expect(answer.status).toBe(204);
    }
    return { ...session, headers };
}

const tokensOf = async (userId: string) => (await prisma.device.findMany({ where: { userId }, select: { pushToken: true } })).map((d) => d.pushToken);

describe('where a phone’s pushes go', () => {
    it('keeps the token for that phone, and moves it when another account signs in on it', async () => {
        const asha = await person('Asha');
        const ravi = await person('Ravi');
        await signedInPhone(asha, TOKEN(1));
        expect(await tokensOf(asha.id)).toEqual([TOKEN(1)]);
        await signedInPhone(ravi, TOKEN(1));
        expect(await tokensOf(asha.id)).toEqual([null]);
        expect(await tokensOf(ravi.id)).toEqual([TOKEN(1)]);
    });

    it('refuses without a session, and a token that isn’t one', async () => {
        const asha = await person('Asha');
        const none = await pushTokenRoute.PUT(new Request('https://splitit.test/api/v1/devices/push-token', { method: 'PUT', body: JSON.stringify({ token: TOKEN(1) }) }));
        expect(none.status).toBe(401);
        const { headers } = await signedInPhone(asha);
        const odd = await pushTokenRoute.PUT(new Request('https://splitit.test/api/v1/devices/push-token', { method: 'PUT', headers, body: JSON.stringify({ token: 'short' }) }));
        expect(odd.status).toBe(400);
    });

    it('stops at sign-out, and at sign-out everywhere', async () => {
        const asha = await person('Asha');
        const phone = await signedInPhone(asha, TOKEN(1));
        await signOutRoute.POST(new Request('https://splitit.test/api/v1/auth/sign-out', { method: 'POST', body: JSON.stringify({ refreshToken: phone.refreshToken }) }));
        expect(await tokensOf(asha.id)).toEqual([null]);

        const a = await signedInPhone(asha, TOKEN(2));
        await signedInPhone(asha, TOKEN(3));
        await everywhereRoute.POST(new Request('https://splitit.test/api/v1/auth/sign-out-everywhere', { method: 'POST', headers: a.headers }));
        expect((await tokensOf(asha.id)).every((token) => token === null)).toBe(true);
    });
});

describe('sending', () => {
    it('reaches only phones still signed in, and forgets a token Firebase says is gone', async () => {
        const asha = await person('Asha');
        await signedInPhone(asha, TOKEN(1));
        const old = await signedInPhone(asha, TOKEN(2));
        // The second phone's session ended without the app saying so (it expired).
        await prisma.refreshToken.updateMany({ where: { deviceId: old.deviceId }, data: { expiresAt: new Date(Date.now() - 1000) } });
        await signedInPhone(asha, TOKEN(3));
        gone.add(TOKEN(3));

        const count = await sendPush([asha.id], { title: 'Ravi added an expense', body: '₹600 for lunch', link: '/groups/g1' });
        expect(count).toBe(1);
        expect(sent).toEqual([{ token: TOKEN(1), title: 'Ravi added an expense', link: '/groups/g1' }]);
        expect(await prisma.device.count({ where: { pushToken: TOKEN(3) } })).toBe(0);
    });

    it('sends nothing, and fails nothing, without Firebase set up', async () => {
        vi.stubEnv('FIREBASE_SERVICE_ACCOUNT', '');
        const asha = await person('Asha');
        await signedInPhone(asha, TOKEN(1));
        expect(await sendPush([asha.id], { title: 't', body: 'b' })).toBe(0);
        expect(sent).toEqual([]);
    });

    it('pushes an expense to the group’s other members’ phones', async () => {
        const asha = await person('Asha');
        const ravi = await person('Ravi');
        const { group } = await groupOf(asha, [ravi]);
        const ashaPhone = await signedInPhone(asha, TOKEN(1));
        await signedInPhone(ravi, TOKEN(2));
        const saved = await expensesRoute.POST(new Request('https://splitit.test/api/v1/expenses', {
            method: 'POST',
            headers: ashaPhone.headers,
            body: JSON.stringify({ clientId: 'push-test-expense-0001', groupId: group.id, title: 'Lunch', amount: 60000, category: 'food' }),
        }));
        expect(saved.status).toBe(201);
        await vi.waitFor(() => expect(sent).toHaveLength(1));
        expect(sent[0]).toMatchObject({ token: TOKEN(2), link: `/groups/${group.id}` });
        expect(sent[0].title).toContain('Asha added an expense');
    });
});
