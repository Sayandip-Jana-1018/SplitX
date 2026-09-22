import { describe, expect, it } from 'vitest';
import { MAX_EXPENSE_PAISE, resolveSplits } from '@/lib/expenseSplits';
import { equalSharesById } from '@/lib/splits';
import { createRandom } from '../helpers/random';

const members = ['u-carol', 'u-alice', 'u-bob'];
const total = (splits: { amount: number }[]) => splits.reduce((sum, split) => sum + split.amount, 0);

describe('resolveSplits: equal', () => {
    it('shares among everyone when no one is picked', () => {
        const result = resolveSplits({ amount: 100, splitType: 'equal' }, members);
        expect(result).toEqual({
            ok: true,
            splits: [
                { userId: 'u-alice', amount: 34 },
                { userId: 'u-bob', amount: 33 },
                { userId: 'u-carol', amount: 33 },
            ],
        });
    });

    it('treats an empty pick as everyone, never as nobody', () => {
        const result = resolveSplits({ amount: 90, splitType: 'equal', splitAmong: [] }, members);
        expect(result.ok && result.splits.map((split) => split.userId)).toEqual(['u-alice', 'u-bob', 'u-carol']);
    });

    it('gives the extra paise by member ID, so any order of the same people gives the same shares', () => {
        const a = resolveSplits({ amount: 1_001, splitType: 'equal', splitAmong: ['u-bob', 'u-alice', 'u-carol'] }, members);
        const b = resolveSplits({ amount: 1_001, splitType: 'equal', splitAmong: ['u-carol', 'u-bob', 'u-alice'] }, members);
        expect(a).toEqual(b);
    });

    it('adds up to the amount exactly for any amount and any set of members', () => {
        const random = createRandom(7);
        for (let run = 0; run < 500; run++) {
            const amount = random.int(1, MAX_EXPENSE_PAISE);
            const everyone = Array.from({ length: random.int(1, 40) }, (_, i) => `u-${i}`);
            const picked = everyone.filter(() => random.next() < 0.5);
            const result = resolveSplits({ amount, splitType: 'equal', splitAmong: picked }, everyone);
            expect(result.ok).toBe(true);
            if (!result.ok) continue;
            expect(total(result.splits)).toBe(amount);
            const shares = result.splits.map((split) => split.amount);
            expect(Math.max(...shares) - Math.min(...shares)).toBeLessThanOrEqual(1);
        }
    });

    it('refuses someone outside the group', () => {
        expect(resolveSplits({ amount: 100, splitType: 'equal', splitAmong: ['u-alice', 'u-mallory'] }, members))
            .toEqual({ ok: false, error: 'Everyone in the split must be a current member of the group' });
    });

    it('refuses the same person twice', () => {
        expect(resolveSplits({ amount: 100, splitType: 'equal', splitAmong: ['u-alice', 'u-alice'] }, members))
            .toEqual({ ok: false, error: 'Each member can appear only once in a split' });
    });

    it('refuses a group with nobody in it', () => {
        expect(resolveSplits({ amount: 100, splitType: 'equal' }, [])).toEqual({
            ok: false,
            error: 'At least one member must be included in the split',
        });
    });
});

describe('resolveSplits: custom and percentage', () => {
    it('keeps shares that add up to the amount', () => {
        const splits = [{ userId: 'u-alice', amount: 70 }, { userId: 'u-bob', amount: 30 }];
        expect(resolveSplits({ amount: 100, splitType: 'custom', splits }, members)).toEqual({ ok: true, splits });
    });

    it('says exactly by how much the shares miss the amount', () => {
        const splits = [{ userId: 'u-alice', amount: 70 }, { userId: 'u-bob', amount: 29 }];
        expect(resolveSplits({ amount: 100, splitType: 'custom', splits }, members)).toEqual({
            ok: false,
            error: 'Split amounts (99) must equal the transaction total (100)',
        });
    });

    it.each([
        ['no shares at all', [], 'A percentage split needs the amount each member owes'],
        ['a person twice', [{ userId: 'u-alice', amount: 50 }, { userId: 'u-alice', amount: 50 }], 'Each member can appear only once in a split'],
        ['an outsider', [{ userId: 'u-alice', amount: 50 }, { userId: 'u-mallory', amount: 50 }], 'Everyone in the split must be a current member of the group'],
        ['a negative share', [{ userId: 'u-alice', amount: 150 }, { userId: 'u-bob', amount: -50 }], 'Each share must be a whole, non-negative number of paise'],
        ['a fraction of a paisa', [{ userId: 'u-alice', amount: 50.5 }, { userId: 'u-bob', amount: 49.5 }], 'Each share must be a whole, non-negative number of paise'],
    ])('refuses %s', (_, splits, error) => {
        expect(resolveSplits({ amount: 100, splitType: 'percentage', splits }, members)).toEqual({ ok: false, error });
    });
});

describe('resolveSplits: amounts', () => {
    it.each([
        ['zero', 0, 'The amount must be a positive whole number of paise'],
        ['a negative amount', -5, 'The amount must be a positive whole number of paise'],
        ['a fraction of a paisa', 10.5, 'The amount must be a positive whole number of paise'],
        ['more than ₹10,00,000', MAX_EXPENSE_PAISE + 1, 'An expense can be at most ₹10,00,000'],
    ])('refuses %s', (_, amount, error) => {
        expect(resolveSplits({ amount, splitType: 'equal' }, members)).toEqual({ ok: false, error });
    });

    it('accepts exactly ₹10,00,000', () => {
        expect(resolveSplits({ amount: MAX_EXPENSE_PAISE, splitType: 'equal' }, members).ok).toBe(true);
    });
});

describe('equalSharesById', () => {
    it('ignores repeated IDs rather than charging someone twice', () => {
        expect([...equalSharesById(10, ['b', 'a', 'b'])]).toEqual([['a', 5], ['b', 5]]);
    });
});
