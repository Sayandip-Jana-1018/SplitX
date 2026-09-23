import { describe, expect, it } from 'vitest';
import { detectCurrency, parseTransactionText } from '@/lib/transactionParser';

describe('parseTransactionText', () => {
    it('reads rupee amounts from UPI messages and bank texts', () => {
        expect(parseTransactionText('Paid ₹450 to Chai Point via Google Pay').amount).toBe(45_000);
        expect(parseTransactionText('Rs. 1,200.50 debited from A/c XX1234').amount).toBe(120_050);
        expect(parseTransactionText('INR 99 sent to Ravi').currency).toBe('INR');
    });

    it('never reads another currency as rupees (it read "$25.00 paid" as ₹25)', () => {
        const coffee = parseTransactionText('Amount $25.00 paid at Starbucks');

        expect(coffee.currency).toBe('USD');
        expect(coffee.amount).toBeNull();
        expect(parseTransactionText('Total USD 12.50 paid').amount).toBeNull();
    });
});

describe('detectCurrency', () => {
    it.each([
        ['€8.50 bezahlt', 'EUR'],
        ['Total £12.00', 'GBP'],
        ['AED 45 paid', 'AED'],
        ['Paid S$15.00', 'SGD'],
        ['Paid US$15.00', 'USD'],
        ['฿120 received', 'THB'],
        ['Total ¥1,200', 'JPY'],
    ])('reads %s as %s', (text, currency) => {
        expect(detectCurrency(text)).toBe(currency);
    });

    it('reads rupees when the text shows no currency, or shows a rupee sign next to another', () => {
        expect(detectCurrency('Total 450.00 paid')).toBe('INR');
        expect(detectCurrency('Rs 450 (about $5.40)')).toBe('INR');
        expect(detectCurrency('Worked 8 hrs 30 min')).toBe('INR');
    });
});
