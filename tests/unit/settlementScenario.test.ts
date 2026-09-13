import { describe, expect, it } from 'vitest';
import { MAX_SCENARIO_MEMBERS, simulateTrip } from '@/lib/settlementScenario';

describe('simulateTrip', () => {
    it.each([2, 3, 12, 31, 250, MAX_SCENARIO_MEMBERS])('%i members: whole-paise balances that sum to zero', (members) => {
        const trip = simulateTrip(members, 2026);

        expect(trip.members).toHaveLength(members);
        expect(new Set(trip.members.map((m) => m.id)).size).toBe(members);
        expect(new Set(trip.members.map((m) => m.name)).size).toBe(members);
        expect(trip.balances.map((b) => b.id)).toEqual(trip.members.map((m) => m.id));
        expect(trip.balances.every((b) => Number.isSafeInteger(b.amount))).toBe(true);
        expect(trip.balances.reduce((sum, b) => sum + b.amount, 0)).toBe(0);
        expect(trip.expenseCount).toBe(members * 3);
        expect(trip.directTransferCount).toBeLessThanOrEqual((members * (members - 1)) / 2);
        // What changes hands can never exceed what was spent.
        expect(trip.balances.reduce((sum, b) => sum + Math.max(0, b.amount), 0)).toBeLessThanOrEqual(trip.totalSpent);
    });

    it('is reproducible from its seed', () => {
        expect(simulateTrip(400, 9)).toEqual(simulateTrip(400, 9));
        expect(simulateTrip(400, 9).balances).not.toEqual(simulateTrip(400, 10).balances);
    });

    it.each([1, 0, -5, 2.5, MAX_SCENARIO_MEMBERS + 1, Number.NaN])('refuses %s members', (members) => {
        expect(() => simulateTrip(members, 1)).toThrow(RangeError);
    });
});
