/**
 * The app's way to the server: the API contract (src/lib/contract/v1.ts) made into calls.
 *
 * - Every request carries the access token; one about to expire is refreshed first, and a 401 is
 *   refreshed and retried once. However many requests find the token stale, one refresh runs.
 * - Every answer is checked against the contract, so the screens only ever see what it promises.
 * - Every failure is an ApiError saying what kind it was, so a screen can say the right thing:
 *   offline, too slow, signed out, refused (with the server's own sentence), server trouble, or
 *   an answer this app doesn't understand (an old app on a newer server).
 *
 * Pure TypeScript: the phone's secure storage comes in as a SessionStore (session.ts), so the
 * website's test runner can test this file (tests/unit/mobileApiClient.test.ts).
 */
import { z } from 'zod';
import {
    ActivityPage,
    CodeSession,
    ErrorBody,
    GroupDetail,
    GroupList,
    MeAnswer,
    Refreshed,
    Session,
    SignUpAnswer,
    type Me,
    type ProfileUpdate,
    type TokenPair,
    type ActivityQuery,
    type DeviceDetails,
} from '@/lib/contract/v1';

export type ApiErrorKind = 'offline' | 'timeout' | 'signed_out' | 'refused' | 'server' | 'bad_answer';

export class ApiError extends Error {
    constructor(
        readonly kind: ApiErrorKind,
        message: string,
        readonly status: number | null = null,
        readonly code: string | null = null,
    ) {
        super(message);
        this.name = 'ApiError';
    }
}

/** What outlives the app being closed: kept in the phone's secure storage. */
export interface StoredSession {
    refreshToken: string;
    deviceId: string;
}

export interface SessionStore {
    load(): Promise<StoredSession | null>;
    save(session: StoredSession): Promise<void>;
    clear(): Promise<void>;
}

export interface ApiOptions {
    baseUrl: string;
    store: SessionStore;
    /** What this phone is, sent at sign-in. */
    device: () => Omit<DeviceDetails, 'deviceId'>;
    fetch?: typeof fetch;
    timeoutMs?: number;
    /** The server ended the session: the app goes back to sign-in. */
    onSignedOut?: (code: string | null) => void;
    now?: () => number;
}

/** A token this close to expiring is refreshed before use. */
const EARLY_MS = 30_000;

const OFFLINE = 'You’re offline. Your changes are kept and sent when you’re back.';

export function createApi(options: ApiOptions) {
    const send = options.fetch ?? fetch;
    const timeoutMs = options.timeoutMs ?? 15_000;
    const now = options.now ?? Date.now;
    let access: { token: string; expiresAt: number } | null = null;
    let refreshing: Promise<void> | null = null;

    async function request(path: string, init: RequestInit = {}): Promise<Response> {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            return await send(`${options.baseUrl}${path}`, {
                ...init,
                headers: { Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
                signal: controller.signal,
            });
        } catch (error) {
            if (controller.signal.aborted) throw new ApiError('timeout', 'The server is taking too long. Try again in a moment.');
            throw new ApiError('offline', OFFLINE, null, error instanceof Error ? error.name : null);
        } finally {
            clearTimeout(timer);
        }
    }

    async function read<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok) {
            const error = ErrorBody.safeParse(body);
            const message = error.success ? error.data.error : 'Something went wrong. Try again.';
            const code = error.success ? error.data.code : null;
            if (response.status === 401) throw new ApiError('signed_out', message, 401, code);
            // A 404 without the contract's error body: this server doesn't have the call yet (it is older than the app).
            if (response.status === 404 && !error.success) throw new ApiError('bad_answer', 'The server doesn’t have this yet. It needs an update.', 404, 'not_on_server');
            throw new ApiError(response.status >= 500 ? 'server' : 'refused', message, response.status, code);
        }
        const parsed = schema.safeParse(body);
        if (!parsed.success) throw new ApiError('bad_answer', 'This version of SplitIT doesn’t understand the server. Update the app.', response.status);
        return parsed.data;
    }

    function keep(tokens: TokenPair) {
        access = { token: tokens.accessToken, expiresAt: Date.parse(tokens.accessExpiresAt) };
        return options.store.save({ refreshToken: tokens.refreshToken, deviceId: tokens.deviceId });
    }

    /** Forgets the session. `ended` means the server ended it (not you), so the app says so and goes to sign-in. */
    async function endLocally(code: string | null, ended = true) {
        access = null;
        await options.store.clear();
        if (ended) options.onSignedOut?.(code);
    }

    /** One refresh at a time. Signed out ends the session here; offline keeps it for later. */
    function refresh(): Promise<void> {
        refreshing ??= (async () => {
            const stored = await options.store.load();
            if (!stored) throw new ApiError('signed_out', 'Sign in to continue.', null, 'no_session');
            const response = await request('/api/v1/auth/refresh', { method: 'POST', body: JSON.stringify({ refreshToken: stored.refreshToken }) });
            try {
                const { tokens } = await read(response, Refreshed);
                await keep(tokens);
            } catch (error) {
                if (error instanceof ApiError && error.kind === 'signed_out') await endLocally(error.code);
                throw error;
            }
        })().finally(() => {
            refreshing = null;
        });
        return refreshing;
    }

    async function authed<T>(path: string, schema: z.ZodType<T>, init: RequestInit = {}): Promise<T> {
        if (!access || access.expiresAt - EARLY_MS <= now()) await refresh();
        const go = () => request(path, { ...init, headers: { ...init.headers, Authorization: `Bearer ${access?.token ?? ''}` } });
        let response = await go();
        if (response.status === 401) {
            await refresh();
            response = await go();
        }
        return read(response, schema);
    }

    /** A request made before signing in, carrying what this phone is (and its device id from before). */
    async function open<T>(path: string, body: object, schema: z.ZodType<T>, withDevice = true): Promise<T> {
        const stored = withDevice ? await options.store.load() : null;
        const payload = withDevice ? { ...body, device: { ...options.device(), deviceId: stored?.deviceId ?? null } } : body;
        const response = await request(path, { method: 'POST', body: JSON.stringify(payload) });
        return read(response, schema);
    }

    async function startWith(path: string, body: object): Promise<Me> {
        const session = await open(path, body, Session);
        await keep(session.tokens);
        return session.me;
    }

    return {
        /** Whether this phone holds a session (it may still turn out to have ended). */
        hasSession: async () => Boolean(await options.store.load()),
        signInWithPassword: (email: string, password: string) => startWith('/api/v1/auth/password', { email, password }),
        signInWithGoogle: (idToken: string) => startWith('/api/v1/auth/google', { idToken }),
        /** Emails a 6-digit code: to sign in, to confirm a new account again, or to reset a password. */
        requestEmailCode: (email: string, purpose: 'sign_in' | 'confirm_sign_up' | 'password_reset') =>
            open('/api/v1/auth/email-code', { email, purpose }, z.object({ sent: z.boolean() }), false).then(() => undefined),
        /** Signs in with an emailed code; `isNew` means the account has no name yet. */
        async signInWithEmailCode(email: string, code: string, purpose: 'sign_in' | 'confirm_sign_up' = 'sign_in') {
            const session = await open('/api/v1/auth/email-code/verify', { email, code, purpose }, CodeSession);
            await keep(session.tokens);
            return { me: session.me, isNew: session.isNew };
        },
        /** Creates an account; `codeSent` means confirm it with the emailed code next. */
        async signUp(name: string, email: string, password: string): Promise<{ codeSent: boolean; me: Me | null }> {
            const answer = await open('/api/v1/auth/sign-up', { name, email, password }, SignUpAnswer);
            if (answer.session) await keep(answer.session.tokens);
            return { codeSent: answer.codeSent, me: answer.session?.me ?? null };
        },
        /** Sets a new password with an emailed code; every other session ends and this phone is signed in. */
        resetPassword: (email: string, code: string, password: string) => startWith('/api/v1/auth/password-reset', { email, code, password }),
        /** Trades the website's one-time code (after Google or GitHub) and this phone's PKCE verifier for a session. */
        exchangeHandoff: (code: string, verifier: string) => startWith('/api/v1/auth/handoff/exchange', { code, verifier }),
        /** Ends every session of the account, this one too. */
        async signOutEverywhere() {
            // 204: no body, which the client reads as null.
            await authed('/api/v1/auth/sign-out-everywhere', z.null(), { method: 'POST' });
            await endLocally(null, false);
        },
        /** Your name and UPI ID. */
        updateMe: (update: ProfileUpdate) =>
            authed('/api/v1/me', MeAnswer, { method: 'PATCH', body: JSON.stringify(update) }).then((answer) => answer.me),
        /** Ends the session here at once; telling the server is best effort, and nobody waits for it. */
        async signOut() {
            const stored = await options.store.load();
            await endLocally(null, false);
            if (stored) void request('/api/v1/auth/sign-out', { method: 'POST', body: JSON.stringify({ refreshToken: stored.refreshToken }) }).catch(() => undefined);
        },
        me: () => authed('/api/v1/me', MeAnswer).then((answer) => answer.me),
        groups: () => authed('/api/v1/groups', GroupList).then((answer) => answer.groups),
        group: (groupId: string) => authed(`/api/v1/groups/${encodeURIComponent(groupId)}`, GroupDetail),
        activity: (query: Partial<ActivityQuery> = {}) => {
            const params = new URLSearchParams();
            for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== null) params.set(key, String(value));
            const search = params.toString();
            return authed(`/api/v1/activity${search ? `?${search}` : ''}`, ActivityPage);
        },
    };
}

export type Api = ReturnType<typeof createApi>;
