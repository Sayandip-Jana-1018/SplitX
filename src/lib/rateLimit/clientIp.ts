import { isIP } from 'node:net';

/**
 * The client address as recorded by the nearest proxy we trust.
 *
 * Each proxy in front of SplitX appends the address it received the request
 * from to X-Forwarded-For. Entries to the left of those were written by the
 * client and can say anything — keying a rate limit on the leftmost entry lets
 * a client pick a fresh identity per request. The client IP is therefore read
 * TRUSTED_PROXY_HOPS entries from the right:
 *
 *   Vercel, ingress-nginx, a single ALB   → 1 (default)
 *   CloudFront → ALB                      → 2
 *   Nothing in front (local Docker)       → 0: no trustworthy address exists
 */
export function trustedProxyHops(): number {
    const raw = process.env.TRUSTED_PROXY_HOPS;
    if (raw === undefined || raw === '') return 1;
    const hops = Number(raw);
    return Number.isInteger(hops) && hops >= 0 && hops <= 10 ? hops : 1;
}

function stripPort(value: string) {
    const bracketed = value.match(/^\[([^\]]+)\](?::\d+)?$/);
    if (bracketed) return bracketed[1];
    const ipv4WithPort = value.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
    return ipv4WithPort ? ipv4WithPort[1] : value;
}

export function clientIp(headers: Headers, hops = trustedProxyHops()): string | null {
    if (hops === 0) return null;
    const forwarded = headers.get('x-forwarded-for');
    if (!forwarded) return null;

    const entries = forwarded.split(',').map((entry) => entry.trim()).filter(Boolean);
    const candidate = entries[entries.length - hops];
    if (!candidate) return null;

    const address = stripPort(candidate);
    return isIP(address) ? address : null;
}

function expandIpv6(address: string): string[] {
    const [head, tail = ''] = address.split('::');
    const headParts = head ? head.split(':') : [];
    const tailParts = tail ? tail.split(':') : [];
    // An embedded IPv4 suffix (::ffff:1.2.3.4) occupies two groups.
    const last = tailParts.at(-1) ?? headParts.at(-1);
    if (last && last.includes('.')) {
        const octets = last.split('.').map(Number);
        const groups = [((octets[0] << 8) | octets[1]).toString(16), ((octets[2] << 8) | octets[3]).toString(16)];
        if (tailParts.length) tailParts.splice(-1, 1, ...groups);
        else headParts.splice(-1, 1, ...groups);
    }
    const missing = address.includes('::') ? 8 - headParts.length - tailParts.length : 0;
    return [...headParts, ...Array(missing).fill('0'), ...tailParts].map((group) => group.padStart(4, '0').toLowerCase());
}

/**
 * The unit a rate limit applies to. IPv4 addresses are used as-is; IPv6 is
 * grouped by /64, because one subscriber is typically handed a whole /64 and
 * could otherwise rotate through billions of addresses.
 */
export function ipBucket(address: string): string {
    if (isIP(address) !== 6) return address;
    const groups = expandIpv6(address);
    const mappedIpv4 = groups.slice(0, 5).every((g) => g === '0000') && groups[5] === 'ffff';
    if (mappedIpv4) {
        const value = (parseInt(groups[6], 16) << 16) | parseInt(groups[7], 16);
        return [value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join('.');
    }
    return `${groups.slice(0, 4).join(':')}::/64`;
}
