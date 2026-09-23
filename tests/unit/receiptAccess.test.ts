import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { createClient, from, bucket } = vi.hoisted(() => {
    const bucket = { createSignedUrls: vi.fn() };
    const from = vi.fn(() => bucket);
    return { createClient: vi.fn(() => ({ storage: { from } })), from, bucket };
});
vi.mock('@supabase/supabase-js', () => ({ createClient }));

const { RECEIPT_VIEW_SECONDS, withViewableReceipts } = await import('@/lib/receiptAccess');

const STORAGE = 'https://abcdproject.supabase.co';
const privatePhoto = (path: string) => `${STORAGE}/storage/v1/object/authenticated/receipt-photos/${path}`;
const signedLink = (path: string) => `${STORAGE}/storage/v1/object/sign/receipt-photos/${path}?token=t-${path}`;

beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', STORAGE);
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key-for-tests');
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    bucket.createSignedUrls.mockImplementation(async (paths: string[]) => ({
        data: paths.map((path) => ({ path, signedUrl: signedLink(path), error: null })),
        error: null,
    }));
});
afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
});

describe('withViewableReceipts', () => {
    it('turns every private photo in a list into a signed link, with one call to storage', async () => {
        const rows = [
            { id: 't1', receiptUrl: privatePhoto('a/1.jpg') },
            { id: 't2', receiptUrl: null },
            { id: 't3', receiptUrl: privatePhoto('b/2.jpg') },
            { id: 't4', receiptUrl: privatePhoto('a/1.jpg') },
        ];

        const viewable = await withViewableReceipts(rows);

        expect(from).toHaveBeenCalledWith('receipt-photos');
        expect(bucket.createSignedUrls).toHaveBeenCalledTimes(1);
        expect(bucket.createSignedUrls).toHaveBeenCalledWith(['a/1.jpg', 'b/2.jpg'], RECEIPT_VIEW_SECONDS);
        expect(viewable.map((row) => row.receiptUrl)).toEqual([signedLink('a/1.jpg'), null, signedLink('b/2.jpg'), signedLink('a/1.jpg')]);
    });

    it('signs links that stop working within the hour', () => {
        expect(RECEIPT_VIEW_SECONDS).toBe(3_600);
    });

    it('leaves an older public photo as it is, drops an untrusted URL, and calls storage for neither', async () => {
        const publicPhoto = `${STORAGE}/storage/v1/object/public/receipts/a/old.jpg`;

        const viewable = await withViewableReceipts([
            { id: 't1', receiptUrl: publicPhoto },
            { id: 't2', receiptUrl: 'https://tracker.example/pixel.gif' },
        ]);

        expect(viewable.map((row) => row.receiptUrl)).toEqual([publicPhoto, null]);
        expect(createClient).not.toHaveBeenCalled();
    });

    it('leaves out a photo storage can’t sign, and still answers with the rest', async () => {
        bucket.createSignedUrls.mockResolvedValue({
            data: [
                { path: 'a/1.jpg', signedUrl: signedLink('a/1.jpg'), error: null },
                { path: 'b/gone.jpg', signedUrl: '', error: 'Either the object does not exist or you do not have access to it' },
            ],
            error: null,
        });

        const viewable = await withViewableReceipts([
            { id: 't1', receiptUrl: privatePhoto('a/1.jpg') },
            { id: 't2', receiptUrl: privatePhoto('b/gone.jpg') },
        ]);

        expect(viewable.map((row) => row.receiptUrl)).toEqual([signedLink('a/1.jpg'), null]);
    });

    it('answers without photos when storage is down or not configured', async () => {
        bucket.createSignedUrls.mockResolvedValue({ data: null, error: new Error('storage is down') });
        expect((await withViewableReceipts([{ id: 't1', title: 'Taxi', receiptUrl: privatePhoto('a/1.jpg') }]))).toEqual([{ id: 't1', title: 'Taxi', receiptUrl: null }]);

        vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
        expect((await withViewableReceipts([{ id: 't1', receiptUrl: privatePhoto('a/1.jpg') }]))[0].receiptUrl).toBeNull();
    });
});
