import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ids } from '../../helpers/http';

const { auth, prisma, createClient, bucket } = vi.hoisted(() => {
    const bucket = { createSignedUrls: vi.fn() };
    return {
        auth: vi.fn(),
        prisma: {
            user: { findUnique: vi.fn() },
            group: { findFirst: vi.fn() },
            trip: { findMany: vi.fn() },
            transaction: { findMany: vi.fn() },
            groupMember: { findMany: vi.fn() },
        },
        createClient: vi.fn(() => ({ storage: { from: () => bucket } })),
        bucket,
    };
});
vi.mock('@/lib/auth', () => ({ auth }));
vi.mock('@/lib/db', () => ({ prisma }));
vi.mock('@supabase/supabase-js', () => ({ createClient }));

const { GET } = await import('@/app/api/groups/[groupId]/receipts/route');

const STORAGE = 'https://abcdproject.supabase.co';
const expense = (id: string, receiptUrl: string) => ({
    id, title: `Expense ${id}`, amount: 1_000, category: 'food', receiptUrl, date: new Date('2026-09-20T10:00:00Z'), payer: { id: ids.alice, name: 'Alice', image: null },
});
const list = () => GET(new Request(`http://localhost/api/groups/${ids.group}/receipts`), { params: Promise.resolve({ groupId: ids.group }) });

beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', STORAGE);
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key-for-tests');
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    auth.mockResolvedValue({ user: { email: 'alice@example.com' } });
    prisma.user.findUnique.mockResolvedValue({ id: ids.alice });
    prisma.group.findFirst.mockResolvedValue({ id: ids.group });
    prisma.trip.findMany.mockResolvedValue([{ id: ids.trip }]);
    prisma.groupMember.findMany.mockResolvedValue([{ user: { id: ids.alice, name: 'Alice', image: null } }]);
    prisma.transaction.findMany.mockResolvedValue([
        expense('t1', `${STORAGE}/storage/v1/object/authenticated/receipt-photos/${ids.alice}/1.jpg`),
        expense('t2', `${STORAGE}/storage/v1/object/public/receipts/${ids.alice}/old.jpg`),
        expense('t3', 'https://tracker.example/pixel.gif'),
        expense('t4', `${STORAGE}/storage/v1/object/authenticated/receipt-photos/${ids.alice}/gone.jpg`),
    ]);
    bucket.createSignedUrls.mockImplementation(async (paths: string[]) => ({
        data: paths.map((path) => path.endsWith('gone.jpg')
            ? { path, signedUrl: '', error: 'Object not found' }
            : { path, signedUrl: `${STORAGE}/storage/v1/object/sign/receipt-photos/${path}?token=t`, error: null }),
        error: null,
    }));
});
afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
});

describe('GET /api/groups/:groupId/receipts', () => {
    it('shows private photos through signed links, keeps older public ones, and leaves out what can’t be shown', async () => {
        const res = await list();
        const { receipts } = await res.json();

        expect(res.status).toBe(200);
        expect(receipts.map((receipt: { id: string; receiptUrl: string }) => [receipt.id, receipt.receiptUrl])).toEqual([
            ['t1', `${STORAGE}/storage/v1/object/sign/receipt-photos/${ids.alice}/1.jpg?token=t`],
            ['t2', `${STORAGE}/storage/v1/object/public/receipts/${ids.alice}/old.jpg`],
        ]);
    });

    it('signs nothing for someone outside the group', async () => {
        prisma.group.findFirst.mockResolvedValue(null);

        const res = await list();

        expect(res.status).toBe(404);
        expect(prisma.transaction.findMany).not.toHaveBeenCalled();
        expect(bucket.createSignedUrls).not.toHaveBeenCalled();
    });
});
