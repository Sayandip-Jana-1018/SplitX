import { importPKCS8, SignJWT } from 'jose';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';

/**
 * Push notifications to the phone app (docs/mobile/ROADMAP.md, Phase 3), sent
 * straight to Firebase Cloud Messaging's HTTP v1 API with the project's service
 * account: FIREBASE_SERVICE_ACCOUNT holds its JSON key (in Vercel, entered by the
 * owner). Without it, nothing is sent and nothing fails.
 *
 * Only phones still signed in are sent to: a device with a live session (a
 * refresh token neither used, revoked nor expired). A token Firebase says is
 * gone is forgotten. Sending never throws: a push is a courtesy on top of the
 * in-app notification, which is already saved.
 */

export interface PushMessage {
    title: string;
    body: string;
    /** The website's path for what it's about (/groups/…, /settlements); the app maps it to its own screen. */
    link?: string | null;
    type?: string;
}

interface ServiceAccount {
    project_id: string;
    client_email: string;
    private_key: string;
}

const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const TIMEOUT_MS = 5_000;

function serviceAccount(): ServiceAccount | null {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw) as Partial<ServiceAccount>;
        if (!parsed.project_id || !parsed.client_email || !parsed.private_key) return null;
        return { project_id: parsed.project_id, client_email: parsed.client_email, private_key: parsed.private_key };
    } catch {
        // Never log the value: it is a private key.
        logger.error('FIREBASE_SERVICE_ACCOUNT is not valid JSON');
        return null;
    }
}

let cached: { token: string; until: number; email: string } | null = null;

/** An OAuth access token for FCM, kept until a minute before it expires. */
async function accessToken(account: ServiceAccount, now = Date.now()): Promise<string> {
    if (cached && cached.email === account.client_email && cached.until > now) return cached.token;
    const key = await importPKCS8(account.private_key, 'RS256');
    const assertion = await new SignJWT({ scope: SCOPE })
        .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
        .setIssuer(account.client_email)
        .setAudience(TOKEN_URL)
        .setIssuedAt(Math.floor(now / 1000))
        .setExpirationTime(Math.floor(now / 1000) + 3600)
        .sign(key);
    const response = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error('Google refused the service account (HTTP ' + response.status + ')');
    const body = (await response.json()) as { access_token: string; expires_in: number };
    cached = { token: body.access_token, until: now + (body.expires_in - 60) * 1000, email: account.client_email };
    return body.access_token;
}

/** For the tests: forget the cached access token. */
export function forgetPushAccess() {
    cached = null;
}

/** FCM's answer that a token belongs to no app any more: forget it. */
function tokenGone(status: number, body: string) {
    return status === 404 || /UNREGISTERED|registration-token-not-registered|INVALID_ARGUMENT.*token/i.test(body);
}

/** Sends one message to every signed-in phone of each user. Returns how many were sent. */
export async function sendPush(userIds: readonly string[], message: PushMessage, now = new Date()): Promise<number> {
    const account = serviceAccount();
    if (!account || userIds.length === 0) return 0;
    try {
        const devices = await prisma.device.findMany({
            where: {
                userId: { in: [...new Set(userIds)] },
                pushToken: { not: null },
                refreshTokens: { some: { usedAt: null, revokedAt: null, expiresAt: { gt: now } } },
            },
            select: { id: true, pushToken: true },
        });
        if (devices.length === 0) return 0;
        const token = await accessToken(account, now.getTime());
        const url = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(account.project_id)}/messages:send`;
        const data: Record<string, string> = {};
        if (message.link) data.link = message.link;
        if (message.type) data.type = message.type;

        const results = await Promise.all(
            devices.map(async (device) => {
                try {
                    const response = await fetch(url, {
                        method: 'POST',
                        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
                        body: JSON.stringify({
                            message: {
                                token: device.pushToken,
                                notification: { title: message.title, body: message.body },
                                data,
                                android: { priority: 'HIGH', notification: { channel_id: 'activity' } },
                            },
                        }),
                        signal: AbortSignal.timeout(TIMEOUT_MS),
                    });
                    if (response.ok) return true;
                    const text = await response.text();
                    if (tokenGone(response.status, text)) {
                        await prisma.device.update({ where: { id: device.id }, data: { pushToken: null } }).catch(() => undefined);
                    } else {
                        logger.warn('A push was refused', { status: response.status });
                    }
                    return false;
                } catch (error) {
                    logger.warn('A push could not be sent', { err: error });
                    return false;
                }
            }),
        );
        return results.filter(Boolean).length;
    } catch (error) {
        logger.error('Push notifications failed', { err: error });
        return 0;
    }
}
