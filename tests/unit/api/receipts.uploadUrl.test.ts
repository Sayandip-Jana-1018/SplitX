import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setRateLimitStore } from '@/lib/rateLimit';
import type { RateLimitStore } from '@/lib/rateLimit/store';
import { ids, jsonRequest } from '../../helpers/http';

const { auth, prisma, createClient, from, bucket } = vi.hoisted(() => {
    const bucket = { createSignedUploadUrl: vi.fn() };
    const from = vi.fn(() => bucket);
    return {
        auth: vi.fn(),
        prisma: { user: { findUnique: vi.fn() } },
        createClient: vi.fn(() => ({ storage: { from } })),
        from,
        bucket,
    };
});

vi.mock('@/lib/auth', () => ({ auth }));
vi.mock('@/lib/db', () => ({ prisma }));
vi.mock('@supabase/supabase-js', () => ({ createClient }));

const { POST } = await import('@/app/api/receipts/upload-url/route');

const request = (body: unknown) => POST(jsonRequest('http://localhost/api/receipts/upload-url', body));

/** A counter store that allows everything except the keys `refuse` names. */
const counter = (refuse: (key: string) => boolean = () => false): RateLimitStore => ({
    backend: 'redis',
    hit: async (key: string) => ({ allowed: !refuse(key), count: 1, resetMs: 3_600_000 }),
    warm: async () => {},
    close: async () => {},
});

beforeEach(async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://abcdproject.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key-for-tests');
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await setRateLimitStore(counter());
    auth.mockResolvedValue({ user: { email: 'alice@example.com' } });
    prisma.user.findUnique.mockResolvedValue({ id: ids.alice });
    bucket.createSignedUploadUrl.mockImplementation(async (path: string) => ({
        data: { path, token: 'signed-token', signedUrl: `https://abcdproject.supabase.co/storage/v1/object/upload/sign/receipt-photos/${path}?token=signed-token` },
        error: null,
    }));
});

afterEach(async () => {
    await setRateLimitStore(undefined);
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
});

describe('POST /api/receipts/upload-url', () => {
    it("signs a new, randomly named object in the caller's own folder of the private bucket", async () => {
        const res = await request({ contentType: 'image/webp', size: 812_000 });
        const { data } = await res.json();

        expect(res.status).toBe(200);
        expect(createClient).toHaveBeenCalledWith('https://abcdproject.supabase.co', 'service-role-key-for-tests', expect.anything());
        expect(from).toHaveBeenCalledWith('receipt-photos');
        expect(data.path).toMatch(new RegExp(`^${ids.alice}/[0-9a-f-]{36}\\.webp$`));
        expect(bucket.createSignedUploadUrl).toHaveBeenCalledWith(data.path);
        expect(data).toEqual({
            path: data.path,
            uploadUrl: `https://abcdproject.supabase.co/storage/v1/object/upload/sign/receipt-photos/${data.path}?token=signed-token`,
            // What the expense records: the private object, never a public address.
            receiptUrl: `https://abcdproject.supabase.co/storage/v1/object/authenticated/receipt-photos/${data.path}`,
        });
    });

    it('never reuses a name', async () => {
        const first = await (await request({ contentType: 'image/jpeg', size: 1 })).json();
        const second = await (await request({ contentType: 'image/jpeg', size: 1 })).json();
        expect(first.data.path).not.toBe(second.data.path);
    });

    it('requires a signed-in user', async () => {
        auth.mockResolvedValue(null);
        expect((await request({ contentType: 'image/jpeg', size: 100 })).status).toBe(401);
        expect(bucket.createSignedUploadUrl).not.toHaveBeenCalled();
    });

    it.each([
        [{ contentType: 'image/svg+xml', size: 100 }],
        [{ contentType: 'text/html', size: 100 }],
        [{ contentType: 'image/jpeg', size: 5 * 1024 * 1024 + 1 }],
        [{ contentType: 'image/jpeg', size: 0 }],
        [{ contentType: 'image/jpeg' }],
        [{ contentType: 'image/jpeg', size: 100, path: 'someone-else/x.jpg' }],
    ])('refuses %j', async (body) => {
        const res = await request(body);
        expect(res.status).toBe(400);
        expect(bucket.createSignedUploadUrl).not.toHaveBeenCalled();
    });

    it('stops at 20 photos a day for one person, and says when more can be added', async () => {
        await setRateLimitStore(counter((key) => key === `allowance:receipt-upload:${ids.alice}`));

        const res = await request({ contentType: 'image/jpeg', size: 100 });

        expect(res.status).toBe(429);
        expect(res.headers.get('Retry-After')).toBe('3600');
        expect(await res.json()).toMatchObject({ code: 'RECEIPT_QUOTA', error: "You've saved today's 20 receipt photos. More can be added tomorrow." });
        expect(bucket.createSignedUploadUrl).not.toHaveBeenCalled();
    });

    it('stops everyone at the daily ceiling for the whole site', async () => {
        await setRateLimitStore(counter((key) => key === 'allowance:receipt-upload:everyone'));

        const res = await request({ contentType: 'image/jpeg', size: 100 });

        expect(res.status).toBe(429);
        expect(bucket.createSignedUploadUrl).not.toHaveBeenCalled();
    });

    it('signs nothing when the counter is unavailable: the allowance fails closed', async () => {
        await setRateLimitStore(null);

        const res = await request({ contentType: 'image/jpeg', size: 100 });

        expect(res.status).toBe(503);
        expect(await res.json()).toMatchObject({ code: 'RECEIPT_QUOTA_UNAVAILABLE' });
        expect(bucket.createSignedUploadUrl).not.toHaveBeenCalled();
    });

    it('answers 503, not a fallback, when the service role key is missing', async () => {
        vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
        const res = await request({ contentType: 'image/jpeg', size: 100 });

        expect(res.status).toBe(503);
        expect(await res.json()).toMatchObject({ code: 'STORAGE_UNAVAILABLE' });
        expect(createClient).not.toHaveBeenCalled();
    });

    it('answers 502 when storage refuses to sign (for example, before the bucket exists)', async () => {
        bucket.createSignedUploadUrl.mockResolvedValue({ data: null, error: new Error('Bucket not found') });
        const res = await request({ contentType: 'image/jpeg', size: 100 });
        expect(res.status).toBe(502);
    });
});
