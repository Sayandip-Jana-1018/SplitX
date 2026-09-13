import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ids } from '../../helpers/http';

const { auth, prisma, createClient, bucket } = vi.hoisted(() => {
    const bucket = {
        upload: vi.fn(),
        getPublicUrl: vi.fn((path: string) => ({ data: { publicUrl: `https://abcdproject.supabase.co/storage/v1/object/public/receipts/${path}` } })),
    };
    return {
        auth: vi.fn(),
        prisma: { user: { findUnique: vi.fn(), update: vi.fn() } },
        createClient: vi.fn(() => ({ storage: { from: () => bucket } })),
        bucket,
    };
});

vi.mock('@/lib/auth', () => ({ auth }));
vi.mock('@/lib/db', () => ({ prisma }));
vi.mock('@supabase/supabase-js', () => ({ createClient }));

const { POST } = await import('@/app/api/me/avatar/route');

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13];

function upload(bytes: number[] | Uint8Array, name = 'me.png', type = 'image/png') {
    const body = new FormData();
    body.append('file', new File([new Uint8Array(bytes)], name, { type }));
    return POST(new Request('http://localhost/api/me/avatar', { method: 'POST', body }));
}

beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://abcdproject.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key-for-tests');
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    auth.mockResolvedValue({ user: { email: 'alice.smith@example.com' } });
    prisma.user.findUnique.mockResolvedValue({ id: ids.alice });
    prisma.user.update.mockResolvedValue({});
    bucket.upload.mockResolvedValue({ data: { path: 'x' }, error: null });
});

afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
});

describe('POST /api/me/avatar', () => {
    it('stores the photo under a random name in the user folder, typed by its bytes, never overwriting', async () => {
        const res = await upload(PNG, 'holiday.jpg', 'image/jpeg');
        const { image } = await res.json();

        expect(res.status).toBe(200);
        const [path, , options] = bucket.upload.mock.calls[0];
        expect(path).toMatch(new RegExp(`^avatars/${ids.alice}/[0-9a-f-]{36}\\.png$`));
        expect(options).toMatchObject({ contentType: 'image/png', upsert: false });
        expect(image).toBe(`https://abcdproject.supabase.co/storage/v1/object/public/receipts/${path}`);
        // The email address (alice.smith@example.com) used to be part of the public file name.
        expect(image).not.toMatch(/alice\.smith|example\.com|@|%40/);
        expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: ids.alice }, data: { image } });
    });

    it.each([
        ['an SVG', new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), 'a.png', 'image/png'],
        ['HTML named like a photo', new TextEncoder().encode('<html><script>alert(1)</script></html>'), 'a.jpg', 'image/jpeg'],
        ['an empty file', new Uint8Array(), 'a.png', 'image/png'],
    ])('refuses %s', async (_, bytes, name, type) => {
        const res = await upload(bytes, name, type);
        expect(res.status).toBe(400);
        expect(bucket.upload).not.toHaveBeenCalled();
    });

    it('refuses photos over 2 MB', async () => {
        const big = new Uint8Array(2 * 1024 * 1024 + 1);
        big.set(PNG);
        expect((await upload(big)).status).toBe(400);
        expect(bucket.upload).not.toHaveBeenCalled();
    });

    it('fails visibly when storage rejects the upload — no data: URL is saved instead', async () => {
        bucket.upload.mockResolvedValue({ data: null, error: new Error('The resource already exists') });
        const res = await upload(PNG);

        expect(res.status).toBe(502);
        expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('answers 503 without the service role key, and never falls back to the anon key', async () => {
        vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
        const res = await upload(PNG);

        expect(res.status).toBe(503);
        expect(createClient).not.toHaveBeenCalled();
        expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('requires a signed-in user', async () => {
        auth.mockResolvedValue(null);
        expect((await upload(PNG)).status).toBe(401);
    });
});
