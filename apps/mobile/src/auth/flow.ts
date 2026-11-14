/** What every sign-in screen shares: one step at a time, one sentence when it fails, and the way in. */
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { Platform } from 'react-native';
import { authErrorMessage } from './AuthProvider';

/** Runs a step; while it runs `busy` is true, and if it fails `error` says why, in words. */
export function useStep() {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const run = useCallback(async (step: () => Promise<void>) => {
        setBusy(true);
        setError(null);
        try {
            await step();
        } catch (caught) {
            setError(authErrorMessage(caught));
            if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
        } finally {
            setBusy(false);
        }
    }, []);
    return { busy, error, setError, run };
}

/** Into the app, with nothing to go back to: sign-in is behind you. */
export function enterApp() {
    if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    if (router.canDismiss()) router.dismissAll();
    router.replace('/home');
}

export const LOOKS_LIKE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
