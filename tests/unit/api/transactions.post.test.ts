import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ids, jsonRequest } from '../../helpers/http';

const { auth, prisma } = vi.hoisted(() => ({
    auth: vi.fn(),
    prisma: {
        user: { findUnique: vi.fn() },
        trip: { findFirst: vi.fn() },
        transaction: { create: vi.fn() },
        notification: { createMany: vi.fn() },
    },
}));

vi.mock('@/lib/auth', () => ({ auth }));
vi.mock('@/lib/db', () => ({ prisma }));
vi.mock('@/lib/auditLog', () => ({ createAuditLog: vi.fn() }));

const { POST } = await import('@/app/api/transactions/route');

const STORAGE = 'https://abcdproject.supabase.co';
const trustedReceipt = `${STORAGE}/storage/v1/object/public/receipts/receipt_1789_ab12c.jpg`;
const members = [ids.alice, ids.bob, ids.carol];

function send(body: Record<string, unknown>) {
    return POST(jsonRequest('http://localhost/api/transactions', { tripId: ids.trip, title: 'Dinner', amount: 90_000, ...body }));
}

beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', STORAGE);
    auth.mockResolvedValue({ user: { email: 'alice@example.com' } });
    prisma.user.findUnique.mockResolvedValue({ id: ids.alice, name: 'Alice', email: 'alice@example.com' });
    prisma.trip.findFirst.mockResolvedValue({
        id: ids.trip,
        title: 'Goa',
        group: { id: ids.group, members: members.map((userId) => ({ userId })) },
    });
    prisma.transaction.create.mockImplementation(async ({ data }) => ({
        id: 'ctxn00000000001',
        ...data,
        payer: { id: data.payerId, name: 'Alice' },
        trip: { id: ids.trip, title: 'Goa' },
        splits: data.splits.create,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
    }));
    prisma.notification.createMany.mockResolvedValue({ count: 2 });
});

afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
});

describe('POST /api/transactions', () => {
    it('saves the receipt URL attached in the composer (it used to be dropped)', async () => {
        const res = await send({ receiptUrl: trustedReceipt });

        expect(res.status).toBe(201);
        expect(prisma.transaction.create.mock.calls[0][0].data.receiptUrl).toBe(trustedReceipt);
    });

    it('stores null when no receipt is attached', async () => {
        await send({});
        expect(prisma.transaction.create.mock.calls[0][0].data.receiptUrl).toBeNull();
    });

    it.each([
        ['a javascript: URL', 'javascript:alert(1)'],
        ['another site', 'https://evil.example/storage/v1/object/public/receipts/x.jpg'],
    ])('rejects %s as a receipt and writes nothing', async (_, receiptUrl) => {
        const res = await send({ receiptUrl });
        expect(res.status).toBe(400);
        expect(prisma.transaction.create).not.toHaveBeenCalled();
    });

    it('rejects a custom split with no per-member amounts instead of saving an expense nobody owes', async () => {
        const res = await send({ splitType: 'custom' });

        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: 'A custom split needs the amount each member owes' });
        expect(prisma.transaction.create).not.toHaveBeenCalled();
    });

    it('rejects a member listed twice in a split (the database allows one row per member)', async () => {
        const res = await send({
            splitType: 'custom',
            splits: [
                { userId: ids.alice, amount: 45_000 },
                { userId: ids.alice, amount: 45_000 },
            ],
        });
        expect(res.status).toBe(400);
        expect(prisma.transaction.create).not.toHaveBeenCalled();
    });

    it('still rejects splits that do not add up to the total', async () => {
        const res = await send({
            splitType: 'custom',
            splits: [
                { userId: ids.alice, amount: 40_000 },
                { userId: ids.bob, amount: 40_000 },
            ],
        });
        expect(res.status).toBe(400);
        expect(prisma.transaction.create).not.toHaveBeenCalled();
    });

    it('still rejects split members from outside the group', async () => {
        const res = await send({
            splitType: 'custom',
            splits: [
                { userId: ids.alice, amount: 45_000 },
                { userId: ids.stranger, amount: 45_000 },
            ],
        });
        expect(res.status).toBe(400);
        expect(prisma.transaction.create).not.toHaveBeenCalled();
    });

    it('splits equally to the exact paisa across the group', async () => {
        await POST(jsonRequest('http://localhost/api/transactions', { tripId: ids.trip, title: 'Cab', amount: 100 }));

        const shares = prisma.transaction.create.mock.calls[0][0].data.splits.create.map((s: { amount: number }) => s.amount);
        expect(shares).toHaveLength(3);
        expect(shares.reduce((a: number, b: number) => a + b, 0)).toBe(100);
    });

    it('only looks up trips whose group has not been deleted', async () => {
        await send({});
        expect(prisma.trip.findFirst.mock.calls[0][0].where.group.deletedAt).toBeNull();
    });

    it('refuses anonymous requests', async () => {
        auth.mockResolvedValue(null);
        const res = await send({});
        expect(res.status).toBe(401);
        expect(prisma.transaction.create).not.toHaveBeenCalled();
    });
});
