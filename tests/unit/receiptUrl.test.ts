import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isTrustedReceiptUrl, withTrustedReceipt } from '@/lib/receiptUrl';

describe('isTrustedReceiptUrl', () => {
    beforeEach(() => {
        vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://abcdproject.supabase.co');
    });
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it.each([
        'https://abcdproject.supabase.co/storage/v1/object/public/receipts/receipt_1789_x1y2z.jpg',
        'https://abcdproject.supabase.co/storage/v1/object/sign/receipts/a.png?token=abc',
    ])('accepts storage object URLs on the project origin: %s', (url) => {
        expect(isTrustedReceiptUrl(url)).toBe(true);
    });

    it.each([
        ['javascript: URL', 'javascript:alert(document.cookie)'],
        ['data: URL', 'data:image/png;base64,iVBORw0KGgo='],
        ['another site', 'https://evil.example/storage/v1/object/public/receipts/x.jpg'],
        ['look-alike subdomain', 'https://abcdproject.supabase.co.evil.example/storage/v1/object/public/x.jpg'],
        ['plain http downgrade', 'http://abcdproject.supabase.co/storage/v1/object/public/receipts/x.jpg'],
        ['non-storage path', 'https://abcdproject.supabase.co/auth/v1/authorize'],
        ['not a URL', 'receipt.jpg'],
        ['oversized', `https://abcdproject.supabase.co/storage/v1/object/public/${'a'.repeat(2_100)}`],
    ])('rejects %s', (_, url) => {
        expect(isTrustedReceiptUrl(url)).toBe(false);
    });

    it('rejects non-strings', () => {
        expect(isTrustedReceiptUrl(undefined)).toBe(false);
        expect(isTrustedReceiptUrl(42)).toBe(false);
    });

    it('trusts nothing when storage is not configured', () => {
        vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
        expect(isTrustedReceiptUrl('https://abcdproject.supabase.co/storage/v1/object/public/r.jpg')).toBe(false);
    });

    it('clears untrusted URLs already stored in old rows, leaving everything else intact', () => {
        const trusted = { id: 't1', receiptUrl: 'https://abcdproject.supabase.co/storage/v1/object/public/receipts/a.jpg' };
        const legacy = { id: 't2', title: 'Taxi', receiptUrl: 'https://tracker.example/pixel.gif' };
        const none = { id: 't3', receiptUrl: null };

        expect(withTrustedReceipt(trusted)).toBe(trusted);
        expect(withTrustedReceipt(none)).toBe(none);
        expect(withTrustedReceipt(legacy)).toEqual({ id: 't2', title: 'Taxi', receiptUrl: null });
    });

    it('allows http only for a local Supabase instance', () => {
        vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321');
        expect(isTrustedReceiptUrl('http://127.0.0.1:54321/storage/v1/object/public/receipts/r.jpg')).toBe(true);
        vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://storage.example.com');
        expect(isTrustedReceiptUrl('http://storage.example.com/storage/v1/object/public/receipts/r.jpg')).toBe(false);
    });
});
