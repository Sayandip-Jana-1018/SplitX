import { afterEach, describe, expect, it, vi } from 'vitest';
import { clientIp, ipBucket, trustedProxyHops } from '@/lib/rateLimit/clientIp';

const headers = (xff?: string) => new Headers(xff === undefined ? {} : { 'x-forwarded-for': xff });

describe('clientIp', () => {
    afterEach(() => vi.unstubAllEnvs());

    it('reads the address appended by the nearest trusted proxy, not the client-written left side', () => {
        // The client claimed 6.6.6.6; the proxy recorded the real 203.0.113.9.
        expect(clientIp(headers('6.6.6.6, 203.0.113.9'), 1)).toBe('203.0.113.9');
    });

    it('cannot be spoofed by prepending addresses', () => {
        for (const forged of ['1.1.1.1', '1.1.1.1, 2.2.2.2', '10.0.0.1, 192.168.0.1, 172.16.0.1']) {
            expect(clientIp(headers(`${forged}, 198.51.100.7`), 1)).toBe('198.51.100.7');
        }
    });

    it('walks back one entry per trusted hop (CloudFront → ALB)', () => {
        expect(clientIp(headers('6.6.6.6, 198.51.100.7, 130.176.0.1'), 2)).toBe('198.51.100.7');
    });

    it('returns null when there are fewer entries than trusted hops', () => {
        expect(clientIp(headers('198.51.100.7'), 2)).toBeNull();
    });

    it('trusts nothing when no proxy is in front (hops = 0)', () => {
        expect(clientIp(headers('198.51.100.7'), 0)).toBeNull();
    });

    it.each([
        ['[2001:db8::1]:443', '2001:db8::1'],
        ['198.51.100.7:51234', '198.51.100.7'],
        ['2001:db8::1', '2001:db8::1'],
    ])('normalises %s', (entry, expected) => {
        expect(clientIp(headers(entry), 1)).toBe(expected);
    });

    it.each(['not-an-ip', 'unknown', '999.1.1.1', ''])('rejects the non-address %j', (entry) => {
        expect(clientIp(headers(entry), 1)).toBeNull();
    });

    it('returns null without the header', () => {
        expect(clientIp(headers(), 1)).toBeNull();
    });

    it('reads TRUSTED_PROXY_HOPS, defaulting to 1 for missing or invalid values', () => {
        expect(trustedProxyHops()).toBe(1);
        vi.stubEnv('TRUSTED_PROXY_HOPS', '2');
        expect(trustedProxyHops()).toBe(2);
        vi.stubEnv('TRUSTED_PROXY_HOPS', '0');
        expect(trustedProxyHops()).toBe(0);
        for (const bad of ['-1', '1.5', 'lots', '99']) {
            vi.stubEnv('TRUSTED_PROXY_HOPS', bad);
            expect(trustedProxyHops()).toBe(1);
        }
    });
});

describe('ipBucket', () => {
    it('keeps IPv4 addresses as they are', () => {
        expect(ipBucket('198.51.100.7')).toBe('198.51.100.7');
    });

    it('groups IPv6 addresses by their /64', () => {
        expect(ipBucket('2001:db8:85a3:1234:aaaa:bbbb:cccc:dddd')).toBe('2001:0db8:85a3:1234::/64');
        expect(ipBucket('2001:db8:85a3:1234::1')).toBe(ipBucket('2001:db8:85a3:1234:ffff:ffff:ffff:ffff'));
        expect(ipBucket('2001:db8:85a3:1234::1')).not.toBe(ipBucket('2001:db8:85a3:1235::1'));
    });

    it('expands compressed forms consistently', () => {
        expect(ipBucket('::1')).toBe('0000:0000:0000:0000::/64');
        expect(ipBucket('fe80::')).toBe('fe80:0000:0000:0000::/64');
    });

    it('treats IPv4-mapped IPv6 as the IPv4 address it carries', () => {
        expect(ipBucket('::ffff:198.51.100.7')).toBe('198.51.100.7');
        expect(ipBucket('::ffff:c633:6407')).toBe('198.51.100.7');
    });
});
