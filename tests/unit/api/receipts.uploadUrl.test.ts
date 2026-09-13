import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ids, jsonRequest } from '../../helpers/http';

const { auth, prisma, createClient, from, bucket } = vi.hoisted(() => {
    const bucket = {
        createSignedUploadUrl: vi.fn(),
        getPublicUrl: vi.fn((path: string) => ({ data: { publicUrl: `https://abcdproject.supabase.co/storage/v1/object/public/receipts/${path}` } })),
    };
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

beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://abcdproject.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key-for-tests');
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    auth.mockResolvedValue({ user: { email: 'alice@example.com' } });
    prisma.user.findUnique.mockResolvedValue({ id: ids.alice });
    bucket.createSignedUploadUrl.mockImplementation(async (path: string) => ({ data: { path, token: 'signed-token', signedUrl: `https://x/${path}` }, error: null }));
});

afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
});

describe('POST /api/receipts/upload-url', () => {
    it("signs a new, randomly named object in the caller's own folder, with the service role key", async () => {
        const res = await request({ contentType: 'image/webp', size: 812_000 });
        const { data } = await res.json();

        expect(res.status).toBe(200);
        expect(createClient).toHaveBeenCalledWith('https://abcdproject.supabase.co', 'service-role-key-for-tests', expect.anything());
        expect(from).toHaveBeenCalledWith('receipts');
        expect(data.path).toMatch(new RegExp(`^${ids.alice}/[0-9a-f-]{36}\\.webp$`));
        expect(bucket.createSignedUploadUrl).toHaveBeenCalledWith(data.path);
        expect(data).toEqual({ path: data.path, token: 'signed-token', publicUrl: `https://abcdproject.supabase.co/storage/v1/object/public/receipts/${data.path}` });
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
        [{ contentType: 'image/jpeg', size: 10 * 1024 * 1024 + 1 }],
        [{ contentType: 'image/jpeg', size: 0 }],
        [{ contentType: 'image/jpeg' }],
        [{ contentType: 'image/jpeg', size: 100, path: 'someone-else/x.jpg' }],
    ])('refuses %j', async (body) => {
        const res = await request(body);
        expect(res.status).toBe(400);
        expect(bucket.createSignedUploadUrl).not.toHaveBeenCalled();
    });

    it('answers 503, not a fallback, when the service role key is missing', async () => {
        vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
        const res = await request({ contentType: 'image/jpeg', size: 100 });

        expect(res.status).toBe(503);
        expect(await res.json()).toMatchObject({ code: 'STORAGE_UNAVAILABLE' });
        expect(createClient).not.toHaveBeenCalled();
    });

    it('answers 502 when storage refuses to sign', async () => {
        bucket.createSignedUploadUrl.mockResolvedValue({ data: null, error: new Error('Bucket not found') });
        const res = await request({ contentType: 'image/jpeg', size: 100 });
        expect(res.status).toBe(502);
    });
});
