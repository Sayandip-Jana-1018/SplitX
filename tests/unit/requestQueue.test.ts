import { afterEach, describe, expect, it, vi } from 'vitest';
import { arrivalTime, parseRequestStart, queuedMs, REQUEST_START_HEADER, requestStartValue } from '@/lib/requestQueue';

const headers = (value?: string) => new Headers(value === undefined ? {} : { [REQUEST_START_HEADER]: value });

describe('queuedMs', () => {
    const now = 1_788_000_000_000;

    it('measures from the proxy stamp', () => {
        expect(queuedMs(headers(requestStartValue(now - 1_250)), now)).toBe(1_250);
    });

    it('never reports a negative wait for a stamp slightly ahead of this clock', () => {
        expect(queuedMs(headers(requestStartValue(now + 30)), now)).toBe(0);
    });

    it.each([undefined, '', 't=', 't=abc', '1788000000000', 't=1788000000', 't=1788000000000.5'])(
        'ignores a missing or malformed stamp: %j',
        (value) => {
            expect(queuedMs(headers(value), now)).toBeNull();
        }
    );
});

describe('parseRequestStart', () => {
    it("reads this app's millisecond stamp", () => {
        expect(parseRequestStart('t=1788000000123')).toBe(1_788_000_000_123);
    });

    it("reads nginx's $msec, seconds with milliseconds", () => {
        expect(parseRequestStart('t=1788000000.123')).toBe(1_788_000_000_123);
        expect(parseRequestStart('t=1788000000.007')).toBe(1_788_000_000_007);
    });

    it.each([null, undefined, '', 't=', 't=1788000000', 't=1788000000.12', 't=1788000000.1234', 't=-1788000000.123', 't=1788000000.123 ', 'x=1788000000.123', 't=17880000001234'])(
        'rejects %j',
        (value) => {
            expect(parseRequestStart(value)).toBeNull();
        }
    );
});

describe('arrivalTime', () => {
    const now = 1_788_000_000_000;
    const nginx = (msAgo: number) => {
        const at = now - msAgo;
        return headers(`t=${Math.floor(at / 1000)}.${String(at % 1000).padStart(3, '0')}`);
    };

    afterEach(() => vi.unstubAllEnvs());

    it('ignores any upstream stamp unless the deployment trusts one', () => {
        expect(arrivalTime(nginx(4_000), now, false)).toBe(now);
    });

    it('counts the time before the proxy ran when the ingress stamp is trusted', () => {
        expect(arrivalTime(nginx(4_000), now, true)).toBe(now - 4_000);
    });

    it('reads the trust setting from TRUST_UPSTREAM_REQUEST_START', () => {
        vi.stubEnv('TRUST_UPSTREAM_REQUEST_START', 'true');
        expect(arrivalTime(nginx(2_500), now)).toBe(now - 2_500);
        vi.stubEnv('TRUST_UPSTREAM_REQUEST_START', '1');
        expect(arrivalTime(nginx(2_500), now)).toBe(now);
    });

    it('does not believe a stamp older than a minute: that is a broken clock, not a queue', () => {
        expect(arrivalTime(nginx(60_001), now, true)).toBe(now);
        expect(arrivalTime(nginx(59_999), now, true)).toBe(now - 59_999);
    });

    it('tolerates a slightly fast upstream clock without reporting negative waits', () => {
        expect(arrivalTime(nginx(-800), now, true)).toBe(now);
        expect(arrivalTime(nginx(-1_001), now, true)).toBe(now);
    });

    it('falls back to now for a missing or malformed stamp', () => {
        expect(arrivalTime(headers(), now, true)).toBe(now);
        expect(arrivalTime(headers('t=soon'), now, true)).toBe(now);
    });
});
