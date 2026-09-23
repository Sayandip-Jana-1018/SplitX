import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isOwnReceiptUrl, isTrustedReceiptUrl, privateReceiptPath, privateReceiptReference, withTrustedReceipt } from '@/lib/receiptUrl';

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

describe('isOwnReceiptUrl', () => {
    const base = 'https://abcdproject.supabase.co/storage/v1/object/authenticated/receipt-photos';
    beforeEach(() => {
        vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://abcdproject.supabase.co');
    });
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it("accepts a photo in the user's own folder of the private bucket", () => {
        expect(isOwnReceiptUrl(`${base}/cuseralice00001/0b6e2f4e.jpg`, 'cuseralice00001')).toBe(true);
    });

    it.each([
        ["another user's folder", `${base}/cuserbob0000001/0b6e2f4e.jpg`],
        ['a folder whose name merely starts with the id', `${base}/cuseralice00001x/0b6e2f4e.jpg`],
        ['a climb out of the folder', `${base}/cuseralice00001/../cuserbob0000001/0b6e2f4e.jpg`],
        ['an encoded climb out of the folder', `${base}/cuseralice00001/%2e%2e/cuserbob0000001/0b6e2f4e.jpg`],
        ['an old upload at the bucket root', `${base}/receipt_1789_ab12c.jpg`],
        ['a public photo, even in the own folder', 'https://abcdproject.supabase.co/storage/v1/object/public/receipts/cuseralice00001/a.jpg'],
        ['a signed link to the own photo', `https://abcdproject.supabase.co/storage/v1/object/sign/receipt-photos/cuseralice00001/a.jpg?token=t`],
        ['another bucket', 'https://abcdproject.supabase.co/storage/v1/object/authenticated/avatars/cuseralice00001/a.jpg'],
        ['another site', `https://evil.example/storage/v1/object/authenticated/receipt-photos/cuseralice00001/a.jpg`],
    ])('rejects %s', (_, url) => {
        expect(isOwnReceiptUrl(url, 'cuseralice00001')).toBe(false);
    });
});

describe('private photo references', () => {
    beforeEach(() => {
        vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://abcdproject.supabase.co');
    });
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('records an upload as the private object, and reads its path back', () => {
        const reference = privateReceiptReference('cuseralice00001/0b6e2f4e.jpg');

        expect(reference).toBe('https://abcdproject.supabase.co/storage/v1/object/authenticated/receipt-photos/cuseralice00001/0b6e2f4e.jpg');
        expect(privateReceiptPath(reference)).toBe('cuseralice00001/0b6e2f4e.jpg');
    });

    it('finds no private path in a public photo, another origin, or something that is not a URL', () => {
        expect(privateReceiptPath('https://abcdproject.supabase.co/storage/v1/object/public/receipts/a/b.jpg')).toBeNull();
        expect(privateReceiptPath('https://evil.example/storage/v1/object/authenticated/receipt-photos/a/b.jpg')).toBeNull();
        expect(privateReceiptPath('b.jpg')).toBeNull();
    });

    it('never throws on a crafted escape: the path is not decoded', () => {
        expect(privateReceiptPath('https://abcdproject.supabase.co/storage/v1/object/authenticated/receipt-photos/a/%zz.jpg')).toBe('a/%zz.jpg');
    });

    it('records nothing when storage is not configured', () => {
        vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
        expect(privateReceiptReference('a/b.jpg')).toBeNull();
    });
});
