import { encode } from 'next-auth/jwt';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearIdentityCache, ipIdentity, resolveIdentity } from '@/lib/rateLimit/identity';

const SECRET = 'test-secret-that-is-long-enough-for-hkdf-000000';
const COOKIE = 'authjs.session-token'; // development cookie name (NODE_ENV is "test")

async function sessionCookie(claims: Record<string, unknown>, options: { secret?: string; maxAge?: number } = {}) {
    const token = await encode({ token: claims, secret: options.secret ?? SECRET, salt: COOKIE, maxAge: options.maxAge ?? 3_600 });
    return `${COOKIE}=${token}`;
}

const request = (cookie?: string) => new Request('http://localhost/api/groups', { headers: cookie ? { cookie } : {} });

describe('resolveIdentity', () => {
    beforeEach(() => {
        vi.stubEnv('AUTH_SECRET', SECRET);
        clearIdentityCache();
    });
    afterEach(() => vi.unstubAllEnvs());

    it('counts a verified session against the user, not the network', async () => {
        const cookie = await sessionCookie({ id: 'cuseralice00001', email: 'alice@example.com' });
        const identity = await resolveIdentity(request(cookie), '198.51.100.7');

        expect(identity.kind).toBe('user');
        expect(identity.key).toMatch(/^user:[0-9a-f]{32}$/);
    });

    it('never puts the user ID or email in the key', async () => {
        const cookie = await sessionCookie({ id: 'cuseralice00001', email: 'alice@example.com' });
        const { key } = await resolveIdentity(request(cookie), null);
        expect(key).not.toContain('alice');
        expect(key).not.toContain('cuseralice00001');
    });

    it('gives two users on the same NAT address separate identities', async () => {
        const alice = await resolveIdentity(request(await sessionCookie({ id: 'alice' })), '203.0.113.50');
        const bob = await resolveIdentity(request(await sessionCookie({ id: 'bob' })), '203.0.113.50');
        expect(alice.key).not.toBe(bob.key);
    });

    it.each([
        ['a token encrypted with a different secret', () => sessionCookie({ id: 'mallory' }, { secret: 'attacker-secret-attacker-secret-attacker-00' })],
        ['random bytes', async () => `${COOKIE}=eyJhbGciOiJkaXIiLCJlbmMiOiJBMjU2Q0JDLUhTNTEyIn0.garbage.garbage.garbage.garbage`],
        ['an expired session', () => sessionCookie({ id: 'alice' }, { maxAge: -60 })],
    ])('falls back to the IP for %s', async (_, makeCookie) => {
        const identity = await resolveIdentity(request(await makeCookie()), '198.51.100.7');
        expect(identity).toEqual(ipIdentity('198.51.100.7'));
    });

    it('cannot mint unlimited identities by rotating forged cookies', async () => {
        const keys = new Set<string>();
        for (let i = 0; i < 20; i++) {
            const forged = await sessionCookie({ id: `fake-${i}` }, { secret: `attacker-secret-attacker-secret-${i}-00000000` });
            keys.add((await resolveIdentity(request(forged), '198.51.100.7')).key);
        }
        expect(keys.size).toBe(1);
    });

    it('uses the IP without a session, and a shared bucket without either', async () => {
        expect((await resolveIdentity(request(), '198.51.100.7')).kind).toBe('ip');
        expect(await resolveIdentity(request(), null)).toEqual({ kind: 'unknown', key: 'ip:unknown' });
    });

    it('does not trust sessions at all when no auth secret is configured', async () => {
        const cookie = await sessionCookie({ id: 'alice' });
        vi.stubEnv('AUTH_SECRET', '');
        vi.stubEnv('NEXTAUTH_SECRET', '');
        expect((await resolveIdentity(request(cookie), '198.51.100.7')).kind).toBe('ip');
    });
});
