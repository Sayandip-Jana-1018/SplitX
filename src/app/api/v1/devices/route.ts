import { requireCaller, v1Error, v1Json } from '@/lib/apiV1';
import type { DeviceInfo, DeviceList } from '@/lib/contract/v1';
import { logger } from '@/lib/logger';
import { listDevices } from '@/lib/services/account';

/** GET /api/v1/devices: the phones signed in to your account (signed-out ones aren't listed), this one first. */
export async function GET(request: Request) {
    const auth = await requireCaller(request);
    if (!auth.ok) return auth.response;
    try {
        const devices = await listDevices(auth.caller.userId, auth.caller.deviceId);
        const answer: DeviceList = { devices: devices.map((device): DeviceInfo => ({ id: device.id, platform: device.platform, name: device.name, appVersion: device.appVersion, lastSeenAt: device.lastSeenAt.toISOString(), current: device.current, signedIn: device.signedIn })) };
        return v1Json(answer);
    } catch (error) {
        logger.error('Phone devices read failed', { err: error });
        return v1Error('Couldn’t load your phones. Try again.', 500, 'server_error');
    }
}
