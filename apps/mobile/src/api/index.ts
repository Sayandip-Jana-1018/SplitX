/**
 * The app's one API client.
 *
 * Where it talks to: EXPO_PUBLIC_API_URL when a build sets it; otherwise, while developing, the
 * website's dev server on the laptop (reached over USB with `adb reverse tcp:3000 tcp:3000`), and
 * in a release build the live site.
 */
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { createApi } from './client';
import { secureSessionStore } from './session';

export const API_URL = process.env.EXPO_PUBLIC_API_URL || (__DEV__ ? 'http://127.0.0.1:3000' : 'https://splitsj.vercel.app');

const signedOutListeners = new Set<(code: string | null) => void>();

/** Called when the server ends the session, so the app can go back to sign-in. */
export function onSignedOut(listener: (code: string | null) => void) {
    signedOutListeners.add(listener);
    return () => {
        signedOutListeners.delete(listener);
    };
}

// The phone's model ("SM-S918B"); the web preview has no Platform.constants.
const model = (Platform.constants as { Model?: string } | undefined)?.Model;

export const api = createApi({
    baseUrl: API_URL,
    store: secureSessionStore,
    device: () => ({
        platform: Platform.OS === 'ios' ? 'ios' : 'android',
        name: model ?? null,
        appVersion: Constants.expoConfig?.version ?? null,
    }),
    onSignedOut: (code) => signedOutListeners.forEach((listener) => listener(code)),
});

export { ApiError } from './client';
