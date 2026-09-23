import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { uploadReceipt } from '@/lib/receiptUpload';

const UPLOAD_URL = 'https://abcdproject.supabase.co/storage/v1/object/upload/sign/receipt-photos/cuseralice00001/0b6e.jpg?token=t';
const REFERENCE = 'https://abcdproject.supabase.co/storage/v1/object/authenticated/receipt-photos/cuseralice00001/0b6e.jpg';
const photo = () => new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], 'receipt.jpg', { type: 'image/jpeg' });

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('uploadReceipt', () => {
    beforeEach(() => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });
    afterEach(() => vi.restoreAllMocks());

    it('asks the server for a signed URL, PUTs the photo there with no key, and returns what the expense records', async () => {
        const file = photo();
        const fetchImpl = vi.fn<typeof fetch>(async (input) =>
            String(input) === '/api/receipts/upload-url'
                ? json({ success: true, data: { path: 'cuseralice00001/0b6e.jpg', uploadUrl: UPLOAD_URL, receiptUrl: REFERENCE } })
                : new Response('{"Key":"receipts/cuseralice00001/0b6e.jpg"}', { status: 200 })
        );

        expect(await uploadReceipt(file, fetchImpl)).toBe(REFERENCE);

        const [signUrl, signInit = {}] = fetchImpl.mock.calls[0];
        expect(signUrl).toBe('/api/receipts/upload-url');
        expect(JSON.parse(signInit.body as string)).toEqual({ contentType: 'image/jpeg', size: 4 });

        const [putUrl, putInit = {}] = fetchImpl.mock.calls[1];
        expect(putUrl).toBe(UPLOAD_URL);
        expect(putInit.method).toBe('PUT');
        expect(putInit.body).toBe(file);
        const headers = putInit.headers as Record<string, string>;
        expect(headers).toMatchObject({ 'content-type': 'image/jpeg', 'x-upsert': 'false' });
        expect(Object.keys(headers).map((h) => h.toLowerCase())).not.toContain('apikey');
        expect(Object.keys(headers).map((h) => h.toLowerCase())).not.toContain('authorization');
    });

    it('returns null when the server refuses (signed out, wrong type, too large)', async () => {
        const fetchImpl = vi.fn(async () => json({ success: false, error: 'Please sign in to continue.' }, 401));
        expect(await uploadReceipt(photo(), fetchImpl as typeof fetch)).toBeNull();
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('returns null when storage rejects the photo', async () => {
        const fetchImpl = vi.fn<typeof fetch>(async (input) =>
            String(input) === '/api/receipts/upload-url'
                ? json({ success: true, data: { path: 'p', uploadUrl: UPLOAD_URL, receiptUrl: REFERENCE } })
                : new Response('{"statusCode":"415","error":"invalid_mime_type"}', { status: 400 })
        );
        expect(await uploadReceipt(photo(), fetchImpl as typeof fetch)).toBeNull();
    });

    it('returns null instead of throwing when the network fails', async () => {
        const fetchImpl = vi.fn(async () => {
            throw new TypeError('Failed to fetch');
        });
        expect(await uploadReceipt(photo(), fetchImpl as typeof fetch)).toBeNull();
    });
});
