import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { adjustmentLooksWrong, apportion, splitReceipt } from '@/lib/receiptSplit';

const members = ['a', 'b', 'c'];
const line = (name: string, price: number, quantity = 1) => ({ name, quantity, price });

describe('splitReceipt', () => {
    it('shares the whole printed total: items by who had them, the rest in proportion', () => {
        // Paneer for a and b, naan for everyone, lassi for c; GST, and a 50-paise round-off.
        const split = splitReceipt({
            items: [line('Paneer tikka', 24_000), line('Butter naan', 6_000, 4), line('Lassi', 9_000)],
            taxes: { CGST: 975, SGST: 975 },
            total: 41_000,
            assignments: [['a', 'b'], ['a', 'b', 'c'], ['c']],
            memberIds: members,
        });

        // a and b had ₹140 of items each and c ₹110, so ₹410 splits 140 : 140 : 110.
        expect(split).toEqual({
            shares: [{ userId: 'a', amount: 14_718 }, { userId: 'b', amount: 14_718 }, { userId: 'c', amount: 11_564 }],
            total: 41_000,
            itemsTotal: 39_000,
            taxTotal: 1_950,
            adjustment: 50,
        });
    });

    it('loses no paisa on an item three people share (it used to: 3 × ₹33.33 saved as ₹99.99)', () => {
        const split = splitReceipt({ items: [line('Pizza', 10_000)], taxes: {}, total: 10_000, assignments: [members], memberIds: members });

        expect(split?.shares.map((share) => share.amount)).toEqual([3_334, 3_333, 3_333]);
    });

    it('passes a discount on in proportion, and nobody goes below zero', () => {
        const split = splitReceipt({
            items: [line('Thali', 30_000), line('Juice', 10_000)],
            taxes: {},
            total: 30_000,
            assignments: [['a'], ['b']],
            memberIds: members,
        });

        expect(split?.shares).toEqual([{ userId: 'a', amount: 22_500 }, { userId: 'b', amount: 7_500 }]);
        expect(split?.adjustment).toBe(-10_000);
    });

    it('uses items plus taxes when no total was read', () => {
        const split = splitReceipt({ items: [line('Tea', 2_000)], taxes: { GST: 100 }, total: 0, assignments: [['b']], memberIds: members });

        expect(split?.total).toBe(2_100);
        expect(split?.shares).toEqual([{ userId: 'b', amount: 2_100 }]);
    });

    it('leaves out anyone who had nothing, and lists people in the group’s order', () => {
        const split = splitReceipt({ items: [line('Coffee', 5_000)], taxes: {}, total: 5_000, assignments: [['c', 'a']], memberIds: members });

        expect(split?.shares.map((share) => share.userId)).toEqual(['a', 'c']);
    });

    it('shares a bill of only free items alike among the people on it', () => {
        const split = splitReceipt({ items: [line('Water', 0)], taxes: { 'Cover charge': 600 }, total: 600, assignments: [['a', 'b']], memberIds: members });

        expect(split?.shares.map((share) => share.amount)).toEqual([300, 300]);
    });

    it('is not ready while an item has nobody, or someone outside the group', () => {
        const items = [line('Tea', 2_000), line('Cake', 3_000)];

        expect(splitReceipt({ items, taxes: {}, total: 5_000, assignments: [['a'], []], memberIds: members })).toBeNull();
        expect(splitReceipt({ items, taxes: {}, total: 5_000, assignments: [['a'], ['stranger']], memberIds: members })).toBeNull();
    });

    it('refuses amounts that are not whole, non-negative paise', () => {
        expect(splitReceipt({ items: [line('Discount', -500)], taxes: {}, total: 1_000, assignments: [['a']], memberIds: members })).toBeNull();
        expect(splitReceipt({ items: [line('Tea', 20.5)], taxes: {}, total: 1_000, assignments: [['a']], memberIds: members })).toBeNull();
    });
});

describe('apportion', () => {
    it('always adds up exactly, each part within a paisa of its exact proportion', () => {
        fc.assert(fc.property(
            fc.integer({ min: 0, max: 100_000_000 }),
            fc.array(fc.integer({ min: 0, max: 100_000_000 }), { minLength: 1, maxLength: 30 }).filter((weights) => weights.some((weight) => weight > 0)),
            (amount, weights) => {
                const parts = apportion(amount, weights);
                const sum = weights.reduce((total, weight) => total + weight, 0);

                expect(parts.reduce((total, part) => total + part, 0)).toBe(amount);
                parts.forEach((part, index) => expect(Math.abs(part - (amount * weights[index]) / sum)).toBeLessThan(1));
            },
        ));
    });

    it('gives a leftover paisa to the earlier of two equal claims', () => {
        expect(apportion(1, [1, 1])).toEqual([1, 0]);
    });

    it('needs a weight above zero', () => {
        expect(() => apportion(100, [0, 0])).toThrow(RangeError);
    });
});

describe('adjustmentLooksWrong', () => {
    it('flags a gap over ₹5 and over 5% of the bill, and nothing smaller', () => {
        expect(adjustmentLooksWrong(-2_000, 20_000)).toBe(true);
        expect(adjustmentLooksWrong(400, 1_000)).toBe(false); // 40%, but only ₹4
        expect(adjustmentLooksWrong(900, 20_000)).toBe(false); // ₹9, but 4.5%
    });
});
