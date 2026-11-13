import { SignJWT } from 'jose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ prisma: {} }));
vi.mock('@/lib/sessionVersion', () => ({ currentTokenVersion: vi.fn() }));

const { currentTokenVersion } = await import('@/lib/sessionVersion');
const { mobileCaller, verifyAccessToken, verifyGoogleIdToken, ACCESS_TTL_SECONDS } = await import('@/lib/mobileAuth');

const SECRET = 'a-test-secret-that-is-at-least-32-characters-long';
const key = new TextEncoder().encode(SECRET);

function token(claims: Record<string, unknown>, options: { secret?: Uint8Array; audience?: string; expiresIn?: number; subject?: string } = {}) {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT(claims)
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(options.subject ?? 'user-1')
        .setIssuer('splitit')
        .setAudience(options.audience ?? 'splitit-app')
        .setIssuedAt(now)
        .setExpirationTime(now + (options.expiresIn ?? ACCESS_TTL_SECONDS))
        .sign(options.secret ?? key);
}

beforeEach(() => {
    vi.stubEnv('MOBILE_TOKEN_SECRET', SECRET);
    vi.mocked(currentTokenVersion).mockResolvedValue(3);
});
afterEach(() => vi.unstubAllEnvs());

describe('an access token', () => {
    it('names its account and device while the account is at the version it carries', async () => {
        expect(await verifyAccessToken(await token({ tv: 3, dev: 'phone-1' }))).toEqual({ userId: 'user-1', deviceId: 'phone-1' });
    });

    it('stops working once the account signs out everywhere (its version moved on)', async () => {
        vi.mocked(currentTokenVersion).mockResolvedValue(4);
        expect(await verifyAccessToken(await token({ tv: 3, dev: 'phone-1' }))).toBeNull();
    });

    it('stops working once the account is gone', async () => {
        vi.mocked(currentTokenVersion).mockResolvedValue(null);
        expect(await verifyAccessToken(await token({ tv: 3, dev: 'phone-1' }))).toBeNull();
    });

    it('is refused when signed with another key, for another audience, or expired', async () => {
        const other = new TextEncoder().encode('another-secret-that-is-also-32-characters-long');
        expect(await verifyAccessToken(await token({ tv: 3, dev: 'p' }, { secret: other }))).toBeNull();
        expect(await verifyAccessToken(await token({ tv: 3, dev: 'p' }, { audience: 'someone-else' }))).toBeNull();
        expect(await verifyAccessToken(await token({ tv: 3, dev: 'p' }, { expiresIn: -10 }))).toBeNull();
    });

    it('is refused when it lacks the version or the device', async () => {
        expect(await verifyAccessToken(await token({ dev: 'p' }))).toBeNull();
        expect(await verifyAccessToken(await token({ tv: 3 }))).toBeNull();
    });

    it('is refused, not crashed on, when the server has no signing secret', async () => {
        const signed = await token({ tv: 3, dev: 'p' });
        vi.stubEnv('MOBILE_TOKEN_SECRET', '');
        expect(await verifyAccessToken(signed)).toBeNull();
    });

    it('is read only from a well-formed Bearer header', async () => {
        const signed = await token({ tv: 3, dev: 'phone-1' });
        const call = (authorization?: string) => mobileCaller(new Request('https://x.test/api/v1/me', { headers: authorization ? { authorization } : {} }));
        expect(await call(`Bearer ${signed}`)).toEqual({ userId: 'user-1', deviceId: 'phone-1' });
        expect(await call(signed)).toBeNull();
        expect(await call(`Basic ${signed}`)).toBeNull();
        expect(await call()).toBeNull();
    });
});

describe('a Google ID token', () => {
    it('is refused without asking Google when no Google client is set up', async () => {
        vi.stubEnv('GOOGLE_CLIENT_ID', '');
        vi.stubEnv('GOOGLE_MOBILE_CLIENT_IDS', '');
        expect(await verifyGoogleIdToken('header.payload.signature-that-is-long-enough')).toBeNull();
    });
});
