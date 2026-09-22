import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ids, jsonRequest } from '../../helpers/http';

const { auth, prisma } = vi.hoisted(() => ({
    auth: vi.fn(),
    prisma: {
        user: { findUnique: vi.fn() },
        group: { findFirst: vi.fn() },
        trip: { create: vi.fn() },
    },
}));
vi.mock('@/lib/auth', () => ({ auth }));
vi.mock('@/lib/db', () => ({ prisma }));

const { POST } = await import('@/app/api/trips/route');

beforeEach(() => {
    auth.mockResolvedValue({ user: { email: 'alice@example.com' } });
    prisma.user.findUnique.mockResolvedValue({ id: ids.alice });
    prisma.group.findFirst.mockResolvedValue({ id: ids.group });
    prisma.trip.create.mockImplementation(async ({ data }) => ({ id: ids.trip, ...data }));
});
afterEach(() => vi.resetAllMocks());

const create = (body: Record<string, unknown>) => POST(jsonRequest('http://localhost/api/trips', { groupId: ids.group, title: 'Goa', ...body }));

describe('POST /api/trips', () => {
    it('saves real dates, as dates', async () => {
        const res = await create({ startDate: '2026-10-02', endDate: '2026-10-06' });

        expect(res.status).toBe(201);
        const { data } = prisma.trip.create.mock.calls[0][0];
        expect(data.startDate).toEqual(new Date('2026-10-02'));
        expect(data.endDate).toEqual(new Date('2026-10-06'));
    });

    it('refuses a date it can’t read (it used to reach the database and answer 500)', async () => {
        const res = await create({ startDate: 'next friday' });

        expect(res.status).toBe(400);
        expect((await res.json()).error).toContain('startDate');
        expect(prisma.trip.create).not.toHaveBeenCalled();
    });

    it('refuses a trip that ends before it starts, or in another century', async () => {
        expect((await create({ startDate: '2026-10-06', endDate: '2026-10-02' })).status).toBe(400);
        expect((await create({ startDate: '9999-01-01' })).status).toBe(400);
        expect(prisma.trip.create).not.toHaveBeenCalled();
    });

    it('refuses a title of only spaces and a description past 500 characters', async () => {
        expect((await create({ title: '   ' })).status).toBe(400);
        expect((await create({ description: 'x'.repeat(501) })).status).toBe(400);
    });
});
