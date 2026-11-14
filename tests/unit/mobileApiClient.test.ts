import { describe, expect, it, vi } from 'vitest';
// The phone app's API client (apps/mobile/src/api/client.ts) is plain TypeScript, so it is
// tested here, against a pretend server.
import { ApiError, createApi, type StoredSession } from '../../apps/mobile/src/api/client';

const T0 = Date.parse('2026-11-14T10:00:00.000Z');
const tokens = (n: number, issuedAt = T0) => ({
    accessToken: `access-${n}`,
    accessExpiresAt: new Date(issuedAt + 15 * 60_000).toISOString(),
    refreshToken: `refresh-token-number-${n}-long-enough`,
    refreshExpiresAt: new Date(issuedAt + 60 * 86_400_000).toISOString(),
    deviceId: 'device-1',
});
const me = { id: 'u1', name: 'Asha', email: 'asha@example.test', image: null, upiId: null };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function memoryStore(initial: StoredSession | null = null) {
    let value = initial;
    return { load: vi.fn(async () => value), save: vi.fn(async (next: StoredSession) => { value = next; }), clear: vi.fn(async () => { value = null; }), peek: () => value };
}

function setup(handler: (path: string, init: RequestInit) => Response | Promise<Response>, stored: StoredSession | null = null) {
    const store = memoryStore(stored);
    const calls: string[] = [];
    let clock = T0;
    const onSignedOut = vi.fn();
    const api = createApi({
        baseUrl: 'https://splitit.test',
        store,
        device: () => ({ platform: 'android', name: 'Test', appVersion: '0.1.0' }),
        fetch: (async (url: string, init: RequestInit) => {
            const path = url.replace('https://splitit.test', '');
            calls.push(`${init.method ?? 'GET'} ${path}`);
            return handler(path, init);
        }) as typeof fetch,
        onSignedOut,
        now: () => clock,
    });
    return { api, store, calls, onSignedOut, advance: (ms: number) => { clock += ms; } };
}

describe('the phone’s API client', () => {
    it('signs in, keeps the refresh token, and uses the access token', async () => {
        const { api, store, calls } = setup((path, init) => {
            if (path === '/api/v1/auth/password') {
                expect(JSON.parse(String(init.body)).device).toMatchObject({ platform: 'android', deviceId: null });
                return json(200, { tokens: tokens(1), me });
            }
            expect((init.headers as Record<string, string>).Authorization).toBe('Bearer access-1');
            return json(200, { groups: [] });
        });
        expect(await api.signInWithPassword('asha@example.test', 'pw')).toEqual(me);
        expect(store.peek()).toEqual({ refreshToken: tokens(1).refreshToken, deviceId: 'device-1' });
        expect(await api.groups()).toEqual([]);
        expect(calls).toEqual(['POST /api/v1/auth/password', 'GET /api/v1/groups']);
    });

    it('refreshes an expired access token once, however many requests are waiting', async () => {
        let refreshes = 0;
        const { api } = setup((path) => {
            if (path === '/api/v1/auth/refresh') {
                refreshes += 1;
                return json(200, { tokens: tokens(2) });
            }
            return json(200, { groups: [] });
        }, { refreshToken: tokens(1).refreshToken, deviceId: 'device-1' });
        await Promise.all([api.groups(), api.groups(), api.groups()]);
        expect(refreshes).toBe(1);
    });

    it('refreshes and retries once when the server says the token has ended', async () => {
        let groupCalls = 0;
        const { api, advance } = setup((path) => {
            if (path === '/api/v1/auth/password') return json(200, { tokens: tokens(1), me });
            if (path === '/api/v1/auth/refresh') return json(200, { tokens: tokens(2) });
            groupCalls += 1;
            return groupCalls === 1 ? json(401, { error: 'Your session has ended.', code: 'unauthenticated' }) : json(200, { groups: [] });
        });
        await api.signInWithPassword('a@b.test', 'pw');
        advance(60_000);
        expect(await api.groups()).toEqual([]);
        expect(groupCalls).toBe(2);
    });

    it('signs out locally when the server refuses the refresh token, and says so', async () => {
        const { api, store, onSignedOut } = setup((path) =>
            path === '/api/v1/auth/refresh' ? json(401, { error: 'For your safety this session was ended.', code: 'reused' }) : json(200, { groups: [] }),
            { refreshToken: tokens(1).refreshToken, deviceId: 'device-1' },
        );
        await expect(api.groups()).rejects.toMatchObject({ kind: 'signed_out', code: 'reused' });
        expect(store.peek()).toBeNull();
        expect(onSignedOut).toHaveBeenCalledWith('reused');
    });

    it('keeps the session when the phone is merely offline', async () => {
        const { api, store } = setup(() => {
            throw new TypeError('Network request failed');
        }, { refreshToken: tokens(1).refreshToken, deviceId: 'device-1' });
        const error = await api.groups().catch((caught) => caught);
        expect(error).toBeInstanceOf(ApiError);
        expect(error.kind).toBe('offline');
        expect(store.peek()).not.toBeNull();
    });

    it('shows the server’s own sentence when it refuses, and calls an unknown answer what it is', async () => {
        const refused = setup((path) =>
            path === '/api/v1/auth/password' ? json(401, { error: 'That email and password don’t match an account.', code: 'bad_credentials' }) : json(500, {}),
        );
        await expect(refused.api.signInWithPassword('a@b.test', 'nope')).rejects.toMatchObject({ kind: 'signed_out', message: 'That email and password don’t match an account.', code: 'bad_credentials' });

        const odd = setup((path) => (path === '/api/v1/auth/password' ? json(200, { tokens: tokens(1), me }) : json(200, { groups: 'not a list' })));
        await odd.api.signInWithPassword('a@b.test', 'pw');
        await expect(odd.api.groups()).rejects.toMatchObject({ kind: 'bad_answer' });
    });

    it('signs out here at once even if the server can’t be told', async () => {
        const { api, store, onSignedOut } = setup((path) => {
            if (path === '/api/v1/auth/password') return json(200, { tokens: tokens(1), me });
            throw new TypeError('Network request failed');
        });
        await api.signInWithPassword('a@b.test', 'pw');
        await api.signOut();
        expect(store.peek()).toBeNull();
        expect(await api.hasSession()).toBe(false);
        // You signed out; the server didn't end it, so there's nothing to tell you.
        expect(onSignedOut).not.toHaveBeenCalled();
    });
});

describe('the phone’s sign-in calls', () => {
    it('signs in with an emailed code and says whether the account is new', async () => {
        const { api, store, calls } = setup((path, init) => {
            if (path === '/api/v1/auth/email-code') {
                expect(JSON.parse(String(init.body))).toEqual({ email: 'new@example.test', purpose: 'sign_in' });
                return json(202, { sent: true });
            }
            return json(200, { tokens: tokens(1), me: { ...me, name: null }, isNew: true });
        });
        await api.requestEmailCode('new@example.test', 'sign_in');
        expect(await api.signInWithEmailCode('new@example.test', '123456')).toEqual({ me: { ...me, name: null }, isNew: true });
        expect(store.peek()?.refreshToken).toBe(tokens(1).refreshToken);
        expect(calls).toEqual(['POST /api/v1/auth/email-code', 'POST /api/v1/auth/email-code/verify']);
    });

    it('signs out without waiting for the server', async () => {
        let answer: (response: Response) => void = () => undefined;
        const { api, store, calls } = setup((path) => {
            if (path === '/api/v1/auth/password') return json(200, { tokens: tokens(1), me });
            return new Promise<Response>((resolve) => {
                answer = resolve;
            });
        });
        await api.signInWithPassword('a@b.test', 'pw');
        await api.signOut();
        expect(store.peek()).toBeNull();
        expect(calls).toContain('POST /api/v1/auth/sign-out');
        answer(new Response(null, { status: 204 }));
    });

    it('says plainly when the server doesn’t have a call yet', async () => {
        const { api } = setup(() => new Response('<html>Not found</html>', { status: 404, headers: { 'content-type': 'text/html' } }));
        await expect(api.requestEmailCode('a@b.test', 'sign_in')).rejects.toMatchObject({ kind: 'bad_answer', status: 404, code: 'not_on_server' });
        // A 404 the server explains is its own answer, kept as it is.
        const known = setup(() => json(404, { error: 'No such group.', code: 'not_found' }));
        await expect(known.api.requestEmailCode('a@b.test', 'sign_in')).rejects.toMatchObject({ kind: 'refused', code: 'not_found' });
    });

    it('keeps no session after a sign-up that still needs its code', async () => {
        const { api, store } = setup(() => json(201, { codeSent: true, session: null }));
        expect(await api.signUp('Asha', 'asha@example.test', 'a-good-password')).toEqual({ codeSent: true, me: null });
        expect(store.peek()).toBeNull();
    });

    it('signs out everywhere, here too', async () => {
        const { api, store, onSignedOut } = setup((path) => {
            if (path === '/api/v1/auth/password') return json(200, { tokens: tokens(1), me });
            return new Response(null, { status: 204 });
        });
        await api.signInWithPassword('a@b.test', 'pw');
        await api.signOutEverywhere();
        expect(store.peek()).toBeNull();
        expect(onSignedOut).not.toHaveBeenCalled();
    });
});
