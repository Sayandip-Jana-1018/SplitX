import { describe, expect, it } from 'vitest';
import { formatCurrency } from '@/lib/utils';

/*
 * The one rupee format the app shows and sends: whole rupees bare, and two
 * decimals whenever there are paise. Splitting ₹999 two ways used to show
 * "₹499.5", and a settlement's chat line rounded ₹499.50 to "₹500".
 */
describe('formatCurrency', () => {
    it('shows whole rupees without decimals', () => {
        expect(formatCurrency(45_000)).toBe('₹450');
        expect(formatCurrency(0)).toBe('₹0');
    });

    it('shows two decimals whenever there are paise', () => {
        expect(formatCurrency(49_950)).toBe('₹499.50');
        expect(formatCurrency(5)).toBe('₹0.05');
        expect(formatCurrency(99_999)).toBe('₹999.99');
    });

    it('groups digits the Indian way, and keeps the sign', () => {
        expect(formatCurrency(123_456_700)).toBe('₹12,34,567');
        expect(formatCurrency(-49_950)).toBe('-₹499.50');
    });
});
