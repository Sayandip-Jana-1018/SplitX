import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { ids, jsonRequest } from '../../helpers/http';

const { auth, prisma } = vi.hoisted(() => ({
    auth: vi.fn(),
    prisma: {
        user: { findUnique: vi.fn() },
        trip: { findFirst: vi.fn() },
        transaction: { create: vi.fn(), findUnique: vi.fn() },
        notification: { createMany: vi.fn() },
    },
}));

vi.mock('@/lib/auth', () => ({ auth }));
vi.mock('@/lib/db', () => ({ prisma }));
vi.mock('@/lib/auditLog', () => ({ createAuditLog: vi.fn() }));

const { POST } = await import('@/app/api/transactions/route');

const STORAGE = 'https://abcdproject.supabase.co';
const trustedReceipt = `${STORAGE}/storage/v1/object/public/receipts/${ids.alice}/0b6e2f4e-7a51-4d0e-9f7c-2f3a9d1c5b11.jpg`;
const members = [ids.alice, ids.bob, ids.carol];

function send(body: Record<string, unknown>, headers: Record<string, string> = {}) {
    return POST(jsonRequest('http://localhost/api/transactions', { tripId: ids.trip, title: 'Dinner', amount: 90_000, ...body }, { headers }));
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
    prisma.transaction.findUnique.mockResolvedValue(null);
});

afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
});

describe('POST /api/transactions with an Idempotency-Key (a retried or double-tapped save)', () => {
    const KEY = { 'Idempotency-Key': 'same-expense-saved-again' };
    const saved = { id: 'ctxn00000000001', title: 'Dinner', amount: 90_000 };

    it('stores the key as the saver’s own, so no one else’s key can ever match it', async () => {
        const res = await send({}, KEY);

        expect(res.status).toBe(201);
        expect(prisma.transaction.create.mock.calls[0][0].data.idempotencyKey).toBe(`${ids.alice}:${KEY['Idempotency-Key']}`);
    });

    it('answers a repeat with the expense the first save made, and adds nothing', async () => {
        prisma.transaction.findUnique.mockResolvedValue(saved);

        const res = await send({}, KEY);

        expect(res.status).toBe(200);
        expect(res.headers.get('Idempotency-Replayed')).toBe('true');
        expect(await res.json()).toEqual(saved);
        expect(prisma.transaction.findUnique.mock.calls[0][0].where).toEqual({ idempotencyKey: `${ids.alice}:${KEY['Idempotency-Key']}` });
        expect(prisma.transaction.create).not.toHaveBeenCalled();
    });

    it('when two saves with one key arrive together, answers the second with the first', async () => {
        prisma.transaction.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(saved);
        prisma.transaction.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
            code: 'P2002', clientVersion: 'test', meta: { target: ['idempotencyKey'] },
        }));

        const res = await send({}, KEY);

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual(saved);
    });

    it('refuses a key that isn’t one, and stores none without a key', async () => {
        expect((await send({}, { 'Idempotency-Key': 'short' })).status).toBe(400);
        expect((await send({}, { 'Idempotency-Key': 'has spaces in it and more' })).status).toBe(400);

        await send({});
        expect(prisma.transaction.create.mock.calls[0][0].data.idempotencyKey).toBeNull();
    });
});

describe('POST /api/transactions', () => {
    it('saves the receipt URL attached in the composer (it used to be dropped)', async () => {
        const res = await send({ receiptUrl: trustedReceipt });

        expect(res.status).toBe(201);
        expect(prisma.transaction.create.mock.calls[0][0].data.receiptUrl).toBe(trustedReceipt);
    });

    it('counts expenses with a receipt under source="receipt" and the rest as manual', async () => {
        const { metrics } = await import('@/lib/metrics');
        metrics.transactionsCreated.reset();
        await send({ receiptUrl: trustedReceipt, category: 'food' });
        await send({ category: 'food' });

        const values = (await metrics.transactionsCreated.get()).values;
        expect(values).toEqual(expect.arrayContaining([
            expect.objectContaining({ labels: { source: 'receipt', category: 'food' }, value: 1 }),
            expect.objectContaining({ labels: { source: 'manual', category: 'food' }, value: 1 }),
        ]));
    });

    it('stores null when no receipt is attached', async () => {
        await send({});
        expect(prisma.transaction.create.mock.calls[0][0].data.receiptUrl).toBeNull();
    });

    it.each([
        ['a javascript: URL', 'javascript:alert(1)'],
        ['another site', 'https://evil.example/storage/v1/object/public/receipts/x.jpg'],
        ["another member's upload", `${STORAGE}/storage/v1/object/public/receipts/${ids.bob}/0b6e2f4e-7a51-4d0e-9f7c-2f3a9d1c5b11.jpg`],
        ['a path that climbs out of your folder', `${STORAGE}/storage/v1/object/public/receipts/${ids.alice}/../${ids.bob}/x.jpg`],
        ['an old upload outside any folder', `${STORAGE}/storage/v1/object/public/receipts/receipt_1789_ab12c.jpg`],
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
