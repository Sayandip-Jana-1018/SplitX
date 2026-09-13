import { describe, expect, it } from 'vitest';
import { queuedMs, REQUEST_START_HEADER, requestStartValue } from '@/lib/requestQueue';

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
