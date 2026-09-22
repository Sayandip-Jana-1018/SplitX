import { describe, expect, it } from 'vitest';
import { istDateKey, istMonthKey, istMonthStart } from '@/lib/indiaTime';

// Instants are written in UTC; the comments give India's wall clock.
describe('India time', () => {
    it('turns the month at midnight in India, 18:30 UTC the day before', () => {
        expect(istMonthKey(new Date('2026-09-30T18:29:59.999Z'))).toBe('2026-09'); // 30 Sep, 23:59:59 IST
        expect(istMonthKey(new Date('2026-09-30T18:30:00.000Z'))).toBe('2026-10'); // 1 Oct, 00:00 IST
    });

    it('turns the day at midnight in India', () => {
        expect(istDateKey(new Date('2026-10-04T18:29:59.999Z'))).toBe('2026-10-04');
        expect(istDateKey(new Date('2026-10-04T18:30:00.000Z'))).toBe('2026-10-05');
    });

    it('finds the start of this month, and of months before it, across a year', () => {
        const now = new Date('2026-12-31T20:00:00.000Z'); // 1 Jan 2027, 01:30 IST
        expect(istMonthStart(now).toISOString()).toBe('2026-12-31T18:30:00.000Z');
        expect(istMonthStart(now, -1).toISOString()).toBe('2026-11-30T18:30:00.000Z');
        expect(istMonthStart(now, -12).toISOString()).toBe('2025-12-31T18:30:00.000Z');
        expect(istMonthKey(istMonthStart(now, -1))).toBe('2026-12');
    });
});
