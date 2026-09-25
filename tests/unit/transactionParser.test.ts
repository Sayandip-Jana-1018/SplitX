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

describe('a printed bill', () => {
    // What Tesseract read from the browser tests' receipt, line for line (D-108).
    const scanned = 'Masala Dosa 180.00\nFilter Coffee 120.00\nTOTAL 300.00\nUPI Ref 412345678901\nPaid to Sunrise Cafe\n';

    it('reads its total, which has no rupee sign (it read none, and a lucky "Paid" on the next line hid that)', () => {
        const bill = parseTransactionText(scanned);
        expect(bill.amount).toBe(30_000);
        expect(bill.merchant).toBe('Sunrise Cafe');
        expect(parseTransactionText('TOTAL 300.00').amount).toBe(30_000);
    });

    it('takes the total, not the first price, when the items carry a rupee sign', () => {
        expect(parseTransactionText('Idli ₹60.00\nVada ₹40.00\nTotal ₹100.00').amount).toBe(10_000);
    });

    it('takes the grand total over a sub-total and the taxes', () => {
        expect(parseTransactionText('Sub Total 300.00\nCGST 2.5% 7.50\nSGST 2.5% 7.50\nGrand Total 315.00').amount).toBe(31_500);
        expect(parseTransactionText('Subtotal: 300\nSub-Total 300\nTotal: 315').amount).toBe(31_500);
        expect(parseTransactionText('Grand Total 315.00\nTotal Savings 20').amount).toBe(31_500);
    });

    it('reads a payable amount, with or without a currency or a colon', () => {
        expect(parseTransactionText('Net Payable Rs. 1,250.50').amount).toBe(125_050);
        expect(parseTransactionText('Amount payable: 499').amount).toBe(49_900);
        expect(parseTransactionText('TOTAL INR 2,000').amount).toBe(200_000);
        expect(parseTransactionText('Total Amount - 640').amount).toBe(64_000);
    });

    it('doesn\'t take a count or a tax for the total', () => {
        expect(parseTransactionText('Total Items: 3\nTotal Tax 15.00\nTotal ₹315').amount).toBe(31_500);
        expect(parseTransactionText('Total Qty 2').amount).toBeNull();
    });

    it('still never reads another currency as rupees', () => {
        expect(parseTransactionText('Total USD 12.50').amount).toBeNull();
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
