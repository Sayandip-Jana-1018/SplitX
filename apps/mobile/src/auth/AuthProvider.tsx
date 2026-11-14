/**
 * Who is using the app: nobody yet (signed out), someone trying the made-up demo, or a signed-in
 * account. It is remembered across launches: the session in the phone's secure storage
 * (api/session.ts), the demo choice and the account's profile in app storage, so the app opens
 * at once, offline too, and refreshes the profile when it can.
 *
 * When the server ends the session (a password reset, "sign out of all devices", a copied
 * token), the app goes back to sign-in and says why.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Me, ProfileUpdate } from '@/lib/contract/v1';
import { api, API_URL, ApiError, onSignedOut } from '~/api';
import { ME, personById } from '~/data/ledger';
import { useToast } from '~/ui/Toast';

export type AuthStatus = 'loading' | 'signed_out' | 'demo' | 'signed_in';
type CodePurpose = 'sign_in' | 'confirm_sign_up' | 'password_reset';

interface Auth {
    status: AuthStatus;
    me: Me | null;
    signInWithPassword: (email: string, password: string) => Promise<void>;
    sendCode: (email: string, purpose: CodePurpose) => Promise<void>;
    /** Signs in with an emailed code; `isNew` when the account still needs a name. */
    verifyCode: (email: string, code: string, purpose: 'sign_in' | 'confirm_sign_up') => Promise<{ isNew: boolean }>;
    signUp: (name: string, email: string, password: string) => Promise<{ codeSent: boolean }>;
    resetPassword: (email: string, code: string, password: string) => Promise<void>;
    /** Google or GitHub, through the website's sign-in page in a secure in-app browser. */
    signInWithProvider: (provider: 'google' | 'github') => Promise<'done' | 'cancelled'>;
    signOut: () => Promise<void>;
    signOutEverywhere: () => Promise<void>;
    startDemo: () => Promise<void>;
    leaveDemo: () => Promise<void>;
    saveProfile: (update: ProfileUpdate) => Promise<void>;
}

const MODE_KEY = 'splitit.mode';
const ME_KEY = 'splitit.me';

const ENDED: Record<string, string> = {
    reused: 'For your safety you were signed out. Sign in again.',
    expired: 'You haven’t opened SplitIT in a while. Sign in again.',
    ended: 'You were signed out on all devices. Sign in again.',
};

const Context = createContext<Auth | null>(null);

/** base64 to base64url, as PKCE writes its challenge. */
const base64url = (base64: string) => base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const URL_SAFE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** A PKCE verifier: 64 URL-safe characters from 64 random bytes (each byte's low 6 bits, so evenly random). */
const newVerifier = () => Array.from(Crypto.getRandomBytes(64), (byte) => URL_SAFE[byte & 63]).join('');

export function AuthProvider({ children }: { children: ReactNode }) {
    const toast = useToast();
    const [status, setStatus] = useState<AuthStatus>('loading');
    const [me, setMe] = useState<Me | null>(null);

    const remember = useCallback(async (next: Me | null) => {
        setMe(next);
        if (next) await AsyncStorage.setItem(ME_KEY, JSON.stringify(next)).catch(() => undefined);
        else await AsyncStorage.removeItem(ME_KEY).catch(() => undefined);
    }, []);

    const signedIn = useCallback(
        async (next: Me) => {
            await AsyncStorage.removeItem(MODE_KEY).catch(() => undefined);
            await remember(next);
            setStatus('signed_in');
        },
        [remember],
    );

    // Where the app was when it closed.
    useEffect(() => {
        let alive = true;
        (async () => {
            const [mode, cached, session] = await Promise.all([
                AsyncStorage.getItem(MODE_KEY).catch(() => null),
                AsyncStorage.getItem(ME_KEY).catch(() => null),
                api.hasSession().catch(() => false),
            ]);
            if (!alive) return;
            if (session) {
                try {
                    setMe(cached ? (JSON.parse(cached) as Me) : null);
                } catch {
                    setMe(null);
                }
                setStatus('signed_in');
                // A fresher profile when the server can be reached; offline, the cached one stands.
                api.me()
                    .then((fresh) => {
                        if (alive) void remember(fresh);
                    })
                    .catch(() => undefined);
                return;
            }
            setStatus(mode === 'demo' ? 'demo' : 'signed_out');
        })();
        return () => {
            alive = false;
        };
    }, [remember]);

    // The server ended the session.
    useEffect(
        () =>
            onSignedOut((code) => {
                void remember(null);
                setStatus('signed_out');
                toast(ENDED[code ?? ''] ?? 'Your session ended. Sign in again.', 'info');
                router.replace('/sign-in');
            }),
        [remember, toast],
    );

    const value = useMemo<Auth>(
        () => ({
            status,
            me,
            async signInWithPassword(email, password) {
                await signedIn(await api.signInWithPassword(email.trim(), password));
            },
            async sendCode(email, purpose) {
                await api.requestEmailCode(email.trim(), purpose);
            },
            async verifyCode(email, code, purpose) {
                const answer = await api.signInWithEmailCode(email.trim(), code, purpose);
                await signedIn(answer.me);
                return { isNew: answer.isNew };
            },
            async signUp(name, email, password) {
                const answer = await api.signUp(name.trim(), email.trim(), password);
                if (answer.me) await signedIn(answer.me);
                return { codeSent: answer.codeSent };
            },
            async resetPassword(email, code, password) {
                await signedIn(await api.resetPassword(email.trim(), code, password));
            },
            async signInWithProvider(provider) {
                // PKCE: the challenge goes out, the verifier never leaves the phone.
                const verifier = newVerifier();
                const challenge = base64url(await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, { encoding: Crypto.CryptoEncoding.BASE64 }));
                const back = Linking.createURL('auth');
                const start = `${API_URL}/api/v1/auth/handoff/start?${new URLSearchParams({ challenge, redirect: back, provider }).toString()}`;
                const result = await WebBrowser.openAuthSessionAsync(start, back);
                if (result.type !== 'success') return 'cancelled';
                const answer = Linking.parse(result.url).queryParams ?? {};
                const code = typeof answer.code === 'string' ? answer.code : null;
                if (!code) throw new ApiError('refused', 'That sign-in didn’t finish. Try again.', null, typeof answer.error === 'string' ? answer.error : 'handoff_failed');
                await signedIn(await api.exchangeHandoff(code, verifier));
                return 'done';
            },
            async signOut() {
                await api.signOut();
                await remember(null);
                setStatus('signed_out');
            },
            async signOutEverywhere() {
                await api.signOutEverywhere();
                await remember(null);
                setStatus('signed_out');
            },
            async startDemo() {
                await AsyncStorage.setItem(MODE_KEY, 'demo').catch(() => undefined);
                setStatus('demo');
            },
            async leaveDemo() {
                await AsyncStorage.removeItem(MODE_KEY).catch(() => undefined);
                setStatus('signed_out');
            },
            async saveProfile(update) {
                await remember(await api.updateMe(update));
            },
        }),
        [status, me, signedIn, remember],
    );

    return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useAuth(): Auth {
    const auth = useContext(Context);
    if (!auth) throw new Error('useAuth needs AuthProvider above it');
    return auth;
}

/** The name to show for you: your account's when signed in, the demo's otherwise. */
export function useYou(): { name: string; first: string } {
    const { status, me } = useAuth();
    if (status !== 'signed_in') {
        const demo = personById(ME);
        return { name: demo.name, first: demo.first };
    }
    const name = me?.name?.trim() || me?.email?.split('@')[0] || 'You';
    return { name, first: name.split(/\s+/)[0] };
}

/** The sentence to show for a failed sign-in step. */
export function authErrorMessage(error: unknown): string {
    if (!(error instanceof ApiError)) return 'Something went wrong. Try again.';
    // Accounts reach the live server with the go-live step; until then only the demo works there.
    if (error.code === 'not_on_server') return 'Accounts aren’t open yet. Try the demo for now.';
    if (error.code === 'invalid_invite') return 'That link doesn’t match any group. Check it, or ask for a new one.';
    if (error.kind === 'offline') return 'You’re offline. Connect and try again.';
    return error.message;
}
