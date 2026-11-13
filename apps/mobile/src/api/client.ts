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
import type { z } from 'zod';
import {
    ActivityPage,
    ErrorBody,
    GroupDetail,
    GroupList,
    MeAnswer,
    Refreshed,
    Session,
    type Me,
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

    async function endLocally(code: string | null) {
        access = null;
        await options.store.clear();
        options.onSignedOut?.(code);
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

    async function startWith(path: string, body: object): Promise<Me> {
        const stored = await options.store.load();
        const response = await request(path, { method: 'POST', body: JSON.stringify({ ...body, device: { ...options.device(), deviceId: stored?.deviceId ?? null } }) });
        const session = await read(response, Session);
        await keep(session.tokens);
        return session.me;
    }

    return {
        /** Whether this phone holds a session (it may still turn out to have ended). */
        hasSession: async () => Boolean(await options.store.load()),
        signInWithPassword: (email: string, password: string) => startWith('/api/v1/auth/password', { email, password }),
        signInWithGoogle: (idToken: string) => startWith('/api/v1/auth/google', { idToken }),
        /** Ends the session here at once; telling the server is best effort. */
        async signOut() {
            const stored = await options.store.load();
            await endLocally(null);
            if (stored) await request('/api/v1/auth/sign-out', { method: 'POST', body: JSON.stringify({ refreshToken: stored.refreshToken }) }).catch(() => undefined);
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
