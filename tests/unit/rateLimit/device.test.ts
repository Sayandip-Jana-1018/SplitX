import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deviceCookieOptions, mintDevice, readCookie, verifyDevice } from '@/lib/rateLimit/device';

const SECRET = 'test-secret-that-is-long-enough-for-hkdf-000000';

describe('device identities', () => {
    beforeEach(() => vi.stubEnv('AUTH_SECRET', SECRET));
    afterEach(() => vi.unstubAllEnvs());

    it('verifies a device it minted and returns its identifier', () => {
        const value = mintDevice()!;
        expect(value).toMatch(/^[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{22}$/);
        expect(verifyDevice(value)).toBe(value.split('.')[0]);
    });

    it('mints a different identifier every time', () => {
        const ids = new Set(Array.from({ length: 500 }, () => verifyDevice(mintDevice())));
        expect(ids.size).toBe(500);
    });

    it('rejects an identifier with someone else\'s signature', () => {
        const [idA] = mintDevice()!.split('.');
        const [, signatureB] = mintDevice()!.split('.');
        expect(verifyDevice(`${idA}.${signatureB}`)).toBeNull();
    });

    it('rejects a one-character change to the identifier or the signature', () => {
        for (let i = 0; i < 50; i++) {
            const value = mintDevice()!;
            const flip = (text: string, index: number) => text.slice(0, index) + (text[index] === 'A' ? 'B' : 'A') + text.slice(index + 1);
            expect(verifyDevice(flip(value, 0))).toBeNull();
            expect(verifyDevice(flip(value, 23))).toBeNull();
        }
    });

    it('accepts only the canonical encoding of a signature', () => {
        // The last base64url character of 16 bytes carries 2 bits of data and 4
        // unused bits. Changing only the unused bits decodes to the same bytes.
        const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
        for (let i = 0; i < 50; i++) {
            const value = mintDevice()!;
            const last = alphabet.indexOf(value.at(-1)!);
            const sameBytes = alphabet[(last >> 4 << 4) | ((last & 15) ^ 1)];
            const variant = value.slice(0, -1) + sameBytes;

            expect(Buffer.from(variant.split('.')[1], 'base64url')).toEqual(Buffer.from(value.split('.')[1], 'base64url'));
            expect(verifyDevice(variant)).toBeNull();
        }
    });

    it('rejects a cookie signed with a different secret', () => {
        vi.stubEnv('AUTH_SECRET', 'attacker-secret-attacker-secret-attacker-00');
        const forged = mintDevice()!;
        vi.stubEnv('AUTH_SECRET', SECRET);
        expect(verifyDevice(forged)).toBeNull();
    });

    it.each([
        null,
        undefined,
        '',
        'not-a-device',
        'aaaaaaaaaaaaaaaaaaaaaa',
        'aaaaaaaaaaaaaaaaaaaaaa.',
        '.aaaaaaaaaaaaaaaaaaaaaa',
        'aaaaaaaaaaaaaaaaaaaaaa.aaaaaaaaaaaaaaaaaaaaaa.aaaaaaaaaaaaaaaaaaaaaa',
        'aaaaaaaaaaaaaaaaaaaaa.aaaaaaaaaaaaaaaaaaaaaa',
        'aaaaaaaaaaaaaaaaaaaaaa!aaaaaaaaaaaaaaaaaaaaaa',
        'aaaaaaaaaaaaaaaaaaaa==.aaaaaaaaaaaaaaaaaaaaaa',
    ])('rejects a malformed value: %j', (value) => {
        expect(verifyDevice(value)).toBeNull();
    });

    it('is switched off entirely without an auth secret', () => {
        const value = mintDevice()!;
        vi.stubEnv('AUTH_SECRET', '');
        vi.stubEnv('NEXTAUTH_SECRET', '');
        expect(mintDevice()).toBeNull();
        expect(verifyDevice(value)).toBeNull();
    });

    it('falls back to NEXTAUTH_SECRET, like the session code does', () => {
        vi.stubEnv('AUTH_SECRET', '');
        vi.stubEnv('NEXTAUTH_SECRET', SECRET);
        expect(verifyDevice(mintDevice())).not.toBeNull();
    });

    it('sets a cookie scripts cannot read, sent only to this site, Secure only over HTTPS', () => {
        expect(deviceCookieOptions(true)).toEqual({ httpOnly: true, sameSite: 'lax', secure: true, path: '/', maxAge: 2_592_000 });
        expect(deviceCookieOptions(false).secure).toBe(false);
    });
});

describe('readCookie', () => {
    it('finds one cookie among several, whatever the spacing', () => {
        expect(readCookie('a=1; sx_device=abc.def;b=2', 'sx_device')).toBe('abc.def');
        expect(readCookie('sx_device=first', 'sx_device')).toBe('first');
    });

    it('does not match a cookie whose name only ends with the name', () => {
        expect(readCookie('not_sx_device=abc', 'sx_device')).toBeNull();
    });

    it('returns null when there is no such cookie or no header', () => {
        expect(readCookie('a=1; b=2', 'sx_device')).toBeNull();
        expect(readCookie(null, 'sx_device')).toBeNull();
    });
});
