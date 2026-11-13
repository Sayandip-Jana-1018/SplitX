import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { loadGroupLedgers, planLedgerTransfers } from '@/lib/ledger';
import { logger } from '@/lib/logger';
import { requestSettlement } from '@/lib/services/settlements';
import { TransitionRefused } from '@/lib/settlementTransitions';

/** Settlement amounts are stored in a 32-bit integer column. */
const MAX_SETTLEMENT_PAISE = 2_147_483_647;

const SettleSchema = z.object({
    tripId: z.string().cuid(),
    toUserId: z.string().cuid(),
    /** Set when the receiver records a payment made to them (e.g. cash) on the debtor's behalf. */
    fromUserId: z.string().cuid().optional(),
    amount: z.number().int().positive().max(MAX_SETTLEMENT_PAISE),
    method: z.string().trim().min(1).max(40).default('upi'),
    note: z.string().max(500).optional(),
});

// GET /api/settlements — the caller's settle-up plan across every group they
// belong to; with ?tripId=, the plan of the group that trip belongs to.
//
// Balances belong to a group, across all of its trips (lib/ledger.ts): a trip is
// a slice of the group's history, not an account of its own. ?tripId= used to
// net that one trip with its own rounding, so its answer disagreed with the
// group page.
export async function GET(req: Request) {
    try {
        const session = await auth();
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const tripId = new URL(req.url).searchParams.get('tripId');

        const user = await prisma.user.findUnique({ where: { email: session.user.email } });
        if (!user) return NextResponse.json({ computed: [], recorded: [], balances: {} });

        const access: Prisma.GroupWhereInput = {
            deletedAt: null,
            OR: [
                { ownerId: user.id },
                { members: { some: { userId: user.id } } },
            ],
        };

        let groupIds: string[];
        if (tripId) {
            const accessibleTrip = await prisma.trip.findFirst({
                where: { id: tripId, group: access },
                select: { groupId: true },
            });

            if (!accessibleTrip) {
                return NextResponse.json({ error: 'Trip not found or access denied' }, { status: 404 });
            }
            groupIds = [accessibleTrip.groupId];
        } else {
            const groups = await prisma.group.findMany({ where: access, select: { id: true } });
            groupIds = groups.map((group) => group.id);
        }

        const ledgers = await loadGroupLedgers(groupIds);
        const balances: Record<string, number> = {};
        const computed = [];
        for (const ledger of ledgers) {
            for (const [userId, amount] of Object.entries(ledger.balances)) {
                balances[userId] = (balances[userId] ?? 0) + amount;
            }
            for (const transfer of planLedgerTransfers(ledger)) {
                computed.push({
                    ...transfer,
                    tripId: tripId ?? ledger.defaultTripId,
                    groupId: ledger.groupId,
                    groupName: ledger.groupName,
                    groupEmoji: ledger.groupEmoji,
                    groupBreakdown: [
                        {
                            groupName: ledger.groupName,
                            groupEmoji: ledger.groupEmoji,
                            amount: transfer.amount,
                        },
                    ],
                });
            }
        }
        const recorded = ledgers
            .flatMap((ledger) => ledger.settlements)
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

        return NextResponse.json({ computed, recorded, balances });
    } catch (error) {
        logger.error('Failed to compute settlements', { err: error });
        return NextResponse.json({ error: 'Failed to compute settlements' }, { status: 500 });
    }
}

// POST /api/settlements — create or resume a settlement request.
// Normally the caller is the debtor. A receiver may also record a payment made
// to them (e.g. cash handed over in person) by passing `fromUserId`.
export async function POST(req: Request) {
    try {
        const session = await auth();
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const parsed = SettleSchema.safeParse(await req.json().catch(() => null));
        if (!parsed.success) {
            const issue = parsed.error.issues[0];
            return NextResponse.json(
                { error: issue ? `Invalid ${issue.path.join('.') || 'request'}: ${issue.message}` : 'Invalid request' },
                { status: 400 }
            );
        }

        const user = await prisma.user.findUnique({ where: { email: session.user.email } });
        if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

        // The rules themselves are shared with the phone app (lib/services/settlements.ts).
        try {
            const { settlement, reused } = await requestSettlement(user, parsed.data);
            return NextResponse.json(settlement, { status: reused ? 200 : 201 });
        } catch (error) {
            if (error instanceof TransitionRefused) return NextResponse.json({ error: error.message }, { status: error.status });
            throw error;
        }
    } catch (error) {
        logger.error('Settlement create error', { err: error });
        return NextResponse.json({ error: 'Failed to record settlement' }, { status: 500 });
    }
}
