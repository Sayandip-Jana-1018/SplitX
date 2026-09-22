import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ids, jsonRequest } from '../../helpers/http';

const { auth, prisma, transitionSettlement } = vi.hoisted(() => ({
    auth: vi.fn(),
    prisma: {
        user: { findUnique: vi.fn() },
        group: { findUnique: vi.fn() },
        groupMessage: { create: vi.fn() },
    },
    transitionSettlement: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ auth }));
vi.mock('@/lib/db', () => ({ prisma }));
vi.mock('@/lib/notifications', () => ({ createNotification: vi.fn(), createBulkNotifications: vi.fn() }));
vi.mock('@/lib/settlementTransitions', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/settlementTransitions')>()),
    transitionSettlement,
}));

const { TransitionRefused } = await import('@/lib/settlementTransitions');
const pay = await import('@/app/api/settlements/[id]/pay/route');
const confirm = await import('@/app/api/settlements/[id]/confirm/route');
const approve = await import('@/app/api/settlements/[id]/approve/route');
const byReceiver = await import('@/app/api/settlements/[id]/confirm-by-receiver/route');

const SETTLEMENT = 'csettle00000001';
const context = { params: Promise.resolve({ id: SETTLEMENT }) };
const post = (path: string, body: unknown = {}) => jsonRequest(`http://localhost/api/settlements/${SETTLEMENT}/${path}`, body);

function settlement(overrides: Record<string, unknown> = {}) {
    return {
        id: SETTLEMENT,
        tripId: ids.trip,
        fromId: ids.carol,
        toId: ids.alice,
        amount: 30_000,
        status: 'completed',
        method: 'upi',
        note: null,
        utrNumber: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        from: { id: ids.carol, name: 'Carol', upiId: 'carol@upi' },
        to: { id: ids.alice, name: 'Alice', upiId: 'alice@upi' },
        trip: { id: ids.trip, title: 'Goa', groupId: ids.group },
        ...overrides,
    };
}

/** Runs the route's guard against `current`, the way the real transition does, then "moves" it. */
function transitionsTo(current: ReturnType<typeof settlement>) {
    transitionSettlement.mockImplementation(async ({ guard }) => {
        guard?.(current);
        return { before: current, after: current };
    });
}

beforeEach(() => {
    auth.mockResolvedValue({ user: { email: 'someone@example.com' } });
    prisma.user.findUnique.mockResolvedValue({ id: ids.carol, name: 'Carol' });
    prisma.group.findUnique.mockResolvedValue({ members: [] });
    prisma.groupMessage.create.mockResolvedValue({});
    transitionsTo(settlement());
});

afterEach(() => vi.resetAllMocks());

describe('POST /api/settlements/:id/pay', () => {
    it('opens UPI and returns the link to the receiver', async () => {
        const res = await pay.POST(post('pay'), context);
        const body = await res.json();

        expect(transitionSettlement).toHaveBeenCalledWith(expect.objectContaining({ action: 'open_upi', actorId: ids.carol, data: { method: 'upi' } }));
        expect(body.payeeUpiId).toBe('alice@upi');
        expect(body.upiUrl).toContain('pa=alice%40upi');
    });

    it('names a receiver without a UPI ID with a code the page acts on, and moves nothing', async () => {
        transitionsTo(settlement({ to: { id: ids.alice, name: 'Alice', upiId: null } }));

        const res = await pay.POST(post('pay'), context);

        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({
            error: "Alice hasn't added their UPI ID yet. Ask them to add it in Settings → Payment.",
            code: 'no_upi_id',
        });
    });

    it('passes on a refusal, with its code', async () => {
        transitionSettlement.mockRejectedValue(new TransitionRefused('Balances have changed.', 409, 'balance_changed'));

        const res = await pay.POST(post('pay'), context);

        expect(res.status).toBe(409);
        expect(await res.json()).toEqual({ error: 'Balances have changed.', code: 'balance_changed' });
    });
});

describe('POST /api/settlements/:id/confirm', () => {
    it('marks a cash payment as paid, with the method', async () => {
        const res = await confirm.POST(post('confirm', { action: 'paid', method: 'cash' }), context);

        expect(res.status).toBe(200);
        expect(transitionSettlement).toHaveBeenCalledWith(expect.objectContaining({ action: 'mark_paid', data: { method: 'cash' } }));
    });

    it('keeps the UPI reference for the receiver to check', async () => {
        await confirm.POST(post('confirm', { action: 'paid', utrNumber: ' 412345678901 ' }), context);

        expect(transitionSettlement.mock.calls[0][0].data).toEqual({ method: 'upi', utrNumber: '412345678901' });
    });

    it('never returns either person’s UPI ID', async () => {
        const body = await (await confirm.POST(post('confirm', { action: 'paid' }), context)).json();

        expect(JSON.stringify(body)).not.toContain('@upi');
    });

    it('refuses an unknown payment method', async () => {
        const res = await confirm.POST(post('confirm', { action: 'paid', method: 'bitcoin' }), context);

        expect(res.status).toBe(400);
        expect(transitionSettlement).not.toHaveBeenCalled();
    });
});

describe('POST /api/settlements/:id/approve', () => {
    it('approves, then tells the group', async () => {
        prisma.user.findUnique.mockResolvedValue({ id: ids.alice, name: 'Alice' });

        const res = await approve.POST(post('approve', { action: 'approve' }), context);

        expect(res.status).toBe(200);
        expect(transitionSettlement).toHaveBeenCalledWith(expect.objectContaining({ action: 'approve', actorId: ids.alice }));
        expect(prisma.groupMessage.create).toHaveBeenCalledTimes(1);
    });

    it('sends a payment back when the money has not arrived', async () => {
        await approve.POST(post('approve', { action: 'reject' }), context);

        expect(transitionSettlement).toHaveBeenCalledWith(expect.objectContaining({ action: 'send_back' }));
        expect(prisma.groupMessage.create).not.toHaveBeenCalled();
    });

    it('announces nothing when the move is refused', async () => {
        transitionSettlement.mockRejectedValue(new TransitionRefused('This payment has already been completed.', 409));

        const res = await approve.POST(post('approve', { action: 'approve' }), context);

        expect(res.status).toBe(409);
        expect(prisma.groupMessage.create).not.toHaveBeenCalled();
    });
});

describe('POST /api/settlements/:id/confirm-by-receiver', () => {
    it.each([
        ['accept_cash', 'accept_cash', { method: 'cash' }],
        ['reject', 'decline', undefined],
        ['confirm', 'mark_received', undefined],
    ])('%s moves the settlement with %s', async (action, move, data) => {
        await byReceiver.POST(post('confirm-by-receiver', { action }), context);

        expect(transitionSettlement.mock.calls[0][0].action).toBe(move);
        expect(transitionSettlement.mock.calls[0][0].data).toEqual(data);
    });

    it('refuses an unknown action instead of quietly doing something else', async () => {
        const res = await byReceiver.POST(post('confirm-by-receiver', { action: 'complete' }), context);

        expect(res.status).toBe(400);
        expect(transitionSettlement).not.toHaveBeenCalled();
    });
});
