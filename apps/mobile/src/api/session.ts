/**
 * The session as the phone keeps it: the refresh token and this phone's device id, in the
 * phone's secure storage (Android's Keystore, iPhone's Keychain), never in plain app storage.
 * The 15-minute access token lives only in memory.
 */
import * as SecureStore from 'expo-secure-store';
import type { SessionStore, StoredSession } from './client';

const KEY = 'splitit.session.v1';

export const secureSessionStore: SessionStore = {
    async load() {
        try {
            const raw = await SecureStore.getItemAsync(KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw) as Partial<StoredSession>;
            return typeof parsed.refreshToken === 'string' && typeof parsed.deviceId === 'string' ? { refreshToken: parsed.refreshToken, deviceId: parsed.deviceId } : null;
        } catch {
            // Unreadable (a restored backup, a changed lock screen): sign in again rather than crash.
            return null;
        }
    },
    async save(session) {
        await SecureStore.setItemAsync(KEY, JSON.stringify(session));
    },
    async clear() {
        await SecureStore.deleteItemAsync(KEY).catch(() => undefined);
    },
};
