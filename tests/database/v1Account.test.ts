import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeviceList, ErrorBody } from '@/lib/contract/v1';
import { prisma } from '@/lib/db';
import { startSession } from '@/lib/mobileAuth';
import { emptyDatabase, expense, groupOf, person, sessionOf } from './fixtures';

const { auth, removeAvatars } = vi.hoisted(() => ({ auth: vi.fn(), removeAvatars: vi.fn() }));
vi.mock('@/lib/auth', () => ({ auth }));
vi.mock('@/lib/storage', () => ({ removeAvatars, storageAdmin: vi.fn() }));

const devicesRoute = await import('@/app/api/v1/devices/route');
const deviceRoute = await import('@/app/api/v1/devices/[id]/route');
const meRoute = await import('@/app/api/v1/me/route');
const exportRoute = await import('@/app/api/v1/me/export/route');
const webSessions = await import('@/app/api/me/sessions/route');

beforeAll(() => {
    process.env.MOBILE_TOKEN_SECRET = 'a-database-test-secret-of-32-characters-or-more';
});
beforeEach(emptyDatabase);
afterAll(() => prisma.$disconnect());

async function phone(user: { id: string }, name: string) {
    const session = await startSession(user.id, { platform: 'android', name, appVersion: '0.1.0' });
    return { ...session, headers: { authorization: `Bearer ${session.accessToken}`, 'content-type': 'application/json' } };
}
const get = (headers: Record<string, string>, path: string) => new Request(`https://splitit.test${path}`, { headers });
const del = (headers: Record<string, string>, path: string) => new Request(`https://splitit.test${path}`, { method: 'DELETE', headers });

describe('your phones', () => {
    it('lists them, the one asking first, and signs another out', async () => {
        const asha = await person('Asha');
        const pixel = await phone(asha, 'Pixel');
        const galaxy = await phone(asha, 'Galaxy');

        const { devices } = DeviceList.parse(await (await devicesRoute.GET(get(galaxy.headers, '/api/v1/devices'))).json());
        expect(devices.map((d) => [d.name, d.current, d.signedIn])).toEqual([['Galaxy', true, true], ['Pixel', false, true]]);

        const pixelId = devices[1].id;
        expect((await deviceRoute.DELETE(del(galaxy.headers, `/api/v1/devices/${pixelId}`), { params: Promise.resolve({ id: pixelId }) })).status).toBe(204);
        expect(await prisma.refreshToken.count({ where: { deviceId: pixelId } })).toBe(0);
        expect(DeviceList.parse(await (await devicesRoute.GET(get(galaxy.headers, '/api/v1/devices'))).json()).devices.map((d) => d.name)).toEqual(['Galaxy']);
        expect(pixel.deviceId).toBe(pixelId);
    });

    it('won’t sign out the phone asking, nor anyone else’s', async () => {
        const asha = await person('Asha');
        const ravi = await person('Ravi');
        const mine = await phone(asha, 'Galaxy');
        const his = await phone(ravi, 'Pixel');
        const self = await deviceRoute.DELETE(del(mine.headers, `/api/v1/devices/${mine.deviceId}`), { params: Promise.resolve({ id: mine.deviceId }) });
        expect(ErrorBody.parse(await self.json()).code).toBe('this_device');
        expect((await deviceRoute.DELETE(del(mine.headers, `/api/v1/devices/${his.deviceId}`), { params: Promise.resolve({ id: his.deviceId }) })).status).toBe(404);
    });

    it('stop counting as signed in, and lose their push tokens, when the website signs out of every device', async () => {
        const asha = await person('Asha');
        const galaxy = await phone(asha, 'Galaxy');
        await prisma.device.update({ where: { id: galaxy.deviceId }, data: { pushToken: 'fcm-token-1:APA91bxxxxxxxxxxxxxxxxxxxxxxxx' } });
        auth.mockResolvedValue(sessionOf(asha) as never);
        expect((await webSessions.DELETE()).status).toBe(200);
        expect(await prisma.refreshToken.count({ where: { userId: asha.id, revokedAt: null } })).toBe(0);
        expect((await prisma.device.findUniqueOrThrow({ where: { id: galaxy.deviceId } })).pushToken).toBeNull();
    });
});

describe('your data and your account, from the phone', () => {
    it('gives your data as one document', async () => {
        const asha = await person('Asha');
        const ravi = await person('Ravi');
        const { trip } = await groupOf(asha, [ravi]);
        await expense(trip.id, asha, 600, [asha, ravi]);
        const galaxy = await phone(asha, 'Galaxy');
        const data = await (await exportRoute.GET(get(galaxy.headers, '/api/v1/me/export'))).json();
        expect(data.user).toMatchObject({ id: asha.id, name: 'Asha' });
        expect(data.finances.transactionsPaid).toHaveLength(1);
        expect(data.groups.memberships).toHaveLength(1);
    });

    it('refuses to close an account that owes or is owed, then closes it once square, phones and all', async () => {
        const asha = await person('Asha');
        const ravi = await person('Ravi');
        const { trip } = await groupOf(asha, [ravi]);
        const owed = await expense(trip.id, asha, 600, [asha, ravi]);
        const galaxy = await phone(ravi, 'Galaxy');

        const refused = await meRoute.DELETE(del(galaxy.headers, '/api/v1/me'));
        expect(refused.status).toBe(409);
        expect(ErrorBody.parse(await refused.json()).code).toBe('not_settled');

        await prisma.transaction.update({ where: { id: owed.id }, data: { deletedAt: new Date() } });
        expect((await meRoute.DELETE(del(galaxy.headers, '/api/v1/me'))).status).toBe(204);
        expect(await prisma.device.count({ where: { userId: ravi.id } })).toBe(0);
        expect(await prisma.refreshToken.count({ where: { userId: ravi.id } })).toBe(0);
        expect((await prisma.user.findUniqueOrThrow({ where: { id: ravi.id } })).email).toBeNull();
        // The session it was asked from has ended too.
        expect((await devicesRoute.GET(get(galaxy.headers, '/api/v1/devices'))).status).toBe(401);
    });
});
