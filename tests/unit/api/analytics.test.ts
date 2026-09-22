import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { jsonRequest } from '../../helpers/http';

const { prisma, auth } = vi.hoisted(() => ({
    prisma: {
        user: { findUnique: vi.fn() },
        group: { findMany: vi.fn() },
        transaction: { findMany: vi.fn() },
        settlement: { findMany: vi.fn() },
        budget: { findMany: vi.fn(), upsert: vi.fn() },
    },
    auth: vi.fn(),
}));
vi.mock('@/lib/db', () => ({ prisma }));
vi.mock('@/lib/auth', () => ({ auth }));

const analytics = await import('@/app/api/analytics/route');
const budgets = await import('@/app/api/budgets/route');

// Servers run in UTC (Vercel's do), and this laptop runs in India: without
// pinning the clock's zone, code that reads months off the server's clock
// would pass here and be wrong in production.
const zone = process.env.TZ;
beforeAll(() => {
    process.env.TZ = 'UTC';
});
afterAll(() => {
    if (zone === undefined) delete process.env.TZ;
    else process.env.TZ = zone;
});

const ONE_AM_OCTOBER_FIRST = new Date('2026-09-30T19:00:00.000Z'); // 1 Oct 2026, 00:30 in India

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(ONE_AM_OCTOBER_FIRST);
    auth.mockResolvedValue({ user: { email: 'alice@example.com' } });
    prisma.user.findUnique.mockResolvedValue({ id: 'cuseralice00001' });
});

afterEach(() => {
    vi.useRealTimers();
    vi.resetAllMocks();
});

const expense = (id: string, date: string, amount: number) => ({
    id,
    date: new Date(date),
    amount,
    category: 'food',
    payerId: 'cuseralice00001',
    payer: { id: 'cuseralice00001', name: 'Alice', image: null },
    splits: [],
});

describe('GET /api/analytics', () => {
    it('counts months as India does: just after midnight on the 1st is the new month', async () => {
        prisma.group.findMany.mockResolvedValue([{
            id: 'cgroup000000001',
            name: 'Goa',
            emoji: '🏖️',
            ownerId: 'cuseralice00001',
            owner: { id: 'cuseralice00001', name: 'Alice', image: null },
            members: [],
            trips: [{ id: 'ctrip0000000001', transactions: [] }],
        }]);
        prisma.transaction.findMany.mockResolvedValue([
            expense('late-september', '2026-09-30T18:20:00.000Z', 2_000), // 30 Sep, 23:50 in India
            expense('first-of-october', '2026-09-30T18:40:00.000Z', 1_000), // 1 Oct, 00:10 in India
        ]);
        prisma.settlement.findMany.mockResolvedValue([]);

        const body = await (await analytics.GET(new Request('http://localhost/api/analytics'))).json();

        expect(body.data.currentMonth).toBe('2026-10');
        expect(body.data.totalThisMonth).toBe(1_000);
        expect(body.data.transactionCount).toBe(1);
        expect(body.data.monthlyTrend.slice(-2)).toEqual([
            { month: '2026-09', total: 2_000 },
            { month: '2026-10', total: 1_000 },
        ]);
        expect(body.data.monthlyTrend.map((point: { month: string }) => point.month)[0]).toBe('2026-05');

        // Read from midnight in India: expenses from the start of the oldest
        // month charted, settlements from the start of this one.
        expect(prisma.transaction.findMany.mock.calls[0][0].where.date).toEqual({ gte: new Date('2026-04-30T18:30:00.000Z') });
        expect(prisma.settlement.findMany.mock.calls[0][0].where.createdAt).toEqual({ gte: new Date('2026-09-30T18:30:00.000Z') });
    });
});

describe('/api/budgets', () => {
    it('reads this month as India does by default', async () => {
        prisma.budget.findMany.mockResolvedValue([]);

        await budgets.GET(new Request('http://localhost/api/budgets'));

        expect(prisma.budget.findMany.mock.calls[0][0].where).toEqual({ userId: 'cuseralice00001', month: '2026-10' });
    });

    it('saves only a whole, positive amount for a real month and a named category', async () => {
        prisma.budget.upsert.mockResolvedValue({ id: 'b1' });
        const save = (body: unknown) => budgets.POST(jsonRequest('http://localhost/api/budgets', body));

        expect((await save({ category: 'food', amount: 500_000 })).status).toBe(200);
        expect(prisma.budget.upsert.mock.calls[0][0].create).toMatchObject({ category: 'food', amount: 500_000, month: '2026-10' });

        for (const bad of [
            { category: 'food', amount: 10.5 },
            { category: 'food', amount: 2 ** 31 },
            { category: 'food', amount: 100, month: '2026-13' },
            { category: 'food', amount: 100, month: 'October' },
            { category: '', amount: 100 },
            { category: 'x'.repeat(41), amount: 100 },
        ]) {
            expect((await save(bad)).status).toBe(400);
        }
        const notJson = await budgets.POST(new Request('http://localhost/api/budgets', { method: 'POST', body: '{' }));
        expect(notJson.status).toBe(400);
        expect(prisma.budget.upsert).toHaveBeenCalledTimes(1);
    });
});
