/**
 * Push notifications (Phase 3): a friend added an expense, a payment waits for you to confirm, a
 * reminder. The server sends them through Firebase Cloud Messaging to phones still signed in
 * (src/lib/push.ts on the website).
 *
 * - Asked for only when you choose to (the card on Home, or Profile), never out of the blue.
 * - Once allowed, this phone's token is sent to the server, and again whenever Firebase changes it.
 * - Tapping one opens what it's about; one arriving while the app is open brings your groups up to date.
 * - Not in Expo Go or the web preview: Android's Expo Go can't receive pushes. The APK can.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { router } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState, Linking, Platform } from 'react-native';
import { api } from '~/api';
import { useAuth } from '~/auth/AuthProvider';
import { useLedger } from '~/data/LedgerProvider';
import { refreshInbox } from './inbox';
import { screenFor } from './links';

/** off: not allowed yet; asked-no: refused (only the phone's settings can change that); on: allowed and sent to the server. */
export type PushState = 'unsupported' | 'off' | 'asked-no' | 'on';

interface PushContext {
    state: PushState;
    /** The card on Home was put away. */
    promptHidden: boolean;
    /** Asks the phone, then sends this phone's token to the server. */
    turnOn: () => Promise<PushState>;
    /** The phone's settings for SplitIT, where a refusal is undone. */
    openSettings: () => void;
    hidePrompt: () => void;
}

const HIDDEN_KEY = 'splitit.pushPromptHidden';
const CHANNEL = 'activity';

/** Pushes need a real build on a real phone: not Expo Go on Android, not the web preview. */
const SUPPORTED = Platform.OS !== 'web' && !(Platform.OS === 'android' && Constants.executionEnvironment === ExecutionEnvironment.StoreClient);

if (SUPPORTED) {
    // One that arrives while the app is open still shows, in the list and as a banner.
    Notifications.setNotificationHandler({
        handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
    });
}

/** The link in a tapped notification, wherever this Android build puts it. */
function linkOf(response: Notifications.NotificationResponse): unknown {
    const content = response.notification.request.content;
    const trigger = response.notification.request.trigger as { remoteMessage?: { data?: Record<string, unknown> } } | null;
    return content.data?.link ?? trigger?.remoteMessage?.data?.link;
}

const Context = createContext<PushContext | null>(null);

export function PushProvider({ children }: { children: ReactNode }) {
    const auth = useAuth();
    const { refresh } = useLedger();
    const signedIn = auth.status === 'signed_in';
    const [permission, setPermission] = useState<'unknown' | 'granted' | 'denied' | 'undetermined'>('unknown');
    const [registered, setRegistered] = useState(false);
    const [promptHidden, setPromptHidden] = useState(true);
    const handledColdStart = useRef(false);

    useEffect(() => {
        AsyncStorage.getItem(HIDDEN_KEY)
            .then((value) => setPromptHidden(value === '1'))
            .catch(() => setPromptHidden(false));
    }, []);

    const readPermission = useCallback(async () => {
        if (!SUPPORTED) return;
        const status = await Notifications.getPermissionsAsync().catch(() => null);
        setPermission(!status ? 'unknown' : status.granted ? 'granted' : status.canAskAgain ? 'undetermined' : 'denied');
    }, []);

    /** Android needs the channel before it will ask, and the server names it in every push. */
    const ensureChannel = useCallback(async () => {
        if (Platform.OS !== 'android') return;
        await Notifications.setNotificationChannelAsync(CHANNEL, {
            name: 'Expenses and payments',
            description: 'When friends add or change expenses, pay you back, or remind you.',
            importance: AndroidImportance.HIGH,
            vibrationPattern: [0, 180, 120, 180],
        });
    }, []);

    const register = useCallback(async () => {
        try {
            await ensureChannel();
            const { data } = await Notifications.getDevicePushTokenAsync();
            if (typeof data === 'string' && data) {
                await api.setPushToken(data);
                setRegistered(true);
            }
        } catch {
            // Offline, or Firebase isn't set up in this build: the next open tries again.
            setRegistered(false);
        }
    }, [ensureChannel]);

    // Signed in: what the phone allows; if allowed, make sure the server knows where to send.
    useEffect(() => {
        if (!SUPPORTED || !signedIn) return;
        let live = true;
        void (async () => {
            await ensureChannel().catch(() => undefined);
            await readPermission();
            const status = await Notifications.getPermissionsAsync().catch(() => null);
            if (live && status?.granted) await register();
        })();
        return () => {
            live = false;
        };
    }, [signedIn, ensureChannel, readPermission, register]);

    // Back from the phone's settings: maybe allowed now.
    useEffect(() => {
        if (!SUPPORTED || !signedIn) return;
        const subscription = AppState.addEventListener('change', (state) => {
            if (state !== 'active') return;
            void Notifications.getPermissionsAsync().then((status) => {
                setPermission(status.granted ? 'granted' : status.canAskAgain ? 'undetermined' : 'denied');
                if (status.granted && !registered) void register();
            });
        });
        return () => subscription.remove();
    }, [signedIn, registered, register]);

    // Firebase can change a phone's token: tell the server.
    useEffect(() => {
        if (!SUPPORTED || !signedIn) return;
        const subscription = Notifications.addPushTokenListener(({ data }) => {
            if (typeof data === 'string' && data) void api.setPushToken(data).catch(() => undefined);
        });
        return () => subscription.remove();
    }, [signedIn]);

    // One arriving while the app is open: bring the groups up to date. A tap: open what it's about.
    useEffect(() => {
        if (!SUPPORTED || !signedIn) return;
        // A push while the app is open: the groups and the bell's list catch up.
        const received = Notifications.addNotificationReceivedListener(() => {
            void refresh();
            void refreshInbox();
        });
        const tapped = Notifications.addNotificationResponseReceivedListener((response) => {
            void refresh();
            router.push(screenFor(linkOf(response)) as never);
        });
        // Opened by tapping one while the app was closed.
        if (!handledColdStart.current) {
            handledColdStart.current = true;
            void Notifications.getLastNotificationResponseAsync().then((response) => {
                if (!response) return;
                void Notifications.clearLastNotificationResponseAsync();
                // The screens mount as the app opens: go once they are there.
                setTimeout(() => router.push(screenFor(linkOf(response)) as never), 800);
            });
        }
        return () => {
            received.remove();
            tapped.remove();
        };
    }, [signedIn, refresh]);

    const turnOn = useCallback(async (): Promise<PushState> => {
        if (!SUPPORTED) return 'unsupported';
        await ensureChannel().catch(() => undefined);
        const status = await Notifications.requestPermissionsAsync().catch(() => null);
        if (!status?.granted) {
            setPermission(status?.canAskAgain ? 'undetermined' : 'denied');
            return status?.canAskAgain ? 'off' : 'asked-no';
        }
        setPermission('granted');
        await register();
        return 'on';
    }, [ensureChannel, register]);

    const hidePrompt = useCallback(() => {
        setPromptHidden(true);
        AsyncStorage.setItem(HIDDEN_KEY, '1').catch(() => undefined);
    }, []);

    const openSettings = useCallback(() => {
        void Linking.openSettings();
    }, []);

    const state: PushState = !SUPPORTED ? 'unsupported' : permission === 'granted' ? 'on' : permission === 'denied' ? 'asked-no' : 'off';
    const value = useMemo(() => ({ state, promptHidden, turnOn, openSettings, hidePrompt }), [state, promptHidden, turnOn, openSettings, hidePrompt]);
    return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function usePush(): PushContext {
    const context = useContext(Context);
    if (!context) throw new Error('usePush needs PushProvider above it');
    return context;
}
