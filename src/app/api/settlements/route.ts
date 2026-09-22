import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { createAuditLog } from '@/lib/auditLog';
import { serializeSettlementAuditSnapshot } from '@/lib/auditPayloads';
import { createNotification } from '@/lib/notifications';
import { loadGroupLedger, loadGroupLedgers, planLedgerTransfers, settlementRoom, type SettlementRoom } from '@/lib/ledger';
import { formatCurrency } from '@/lib/utils';
import { logger } from '@/lib/logger';

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

class SettlementRefused extends Error {
    constructor(message: string, readonly status = 400) {
        super(message);
    }
}

/** Why a payment doesn't fit the group's balances, in words for the person making it. */
function explainTooMuch(fit: SettlementRoom, amount: number, receiverName: string, recordedByReceiver: boolean): string | null {
    if (fit.owes === 0) {
        return recordedByReceiver ? 'They don’t owe anything in this group.' : 'You don’t owe anything in this group.';
    }
    if (fit.owed === 0) {
        return recordedByReceiver ? 'You aren’t owed anything in this group.' : `${receiverName} isn’t owed anything in this group.`;
    }
    if (amount <= fit.room) return null;

    if (fit.room < Math.min(fit.owes, fit.owed)) {
        return fit.room === 0
            ? 'Payments already waiting for approval cover this. Approve or cancel those first.'
            : `Only ${formatCurrency(fit.room)} is left to settle once the payments already waiting are approved.`;
    }
    if (fit.owes <= fit.owed) {
        return recordedByReceiver
            ? `That’s more than they owe. Their net balance is ${formatCurrency(fit.owes)} in this group.`
            : `Settlement amount exceeds what you owe. Your net balance is ${formatCurrency(fit.owes)} in this group.`;
    }
    return recordedByReceiver
        ? `That’s more than you are owed. You are owed ${formatCurrency(fit.owed)} in this group.`
        : `That’s more than ${receiverName} is owed. They are owed ${formatCurrency(fit.owed)} in this group.`;
}

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

        const debtorId = parsed.data.fromUserId ?? user.id;
        const recordedByReceiver = debtorId !== user.id;

        // ── Security: receivers may only record payments made to themselves ──
        if (recordedByReceiver && parsed.data.toUserId !== user.id) {
            return NextResponse.json({ error: 'You can only record payments made to you' }, { status: 403 });
        }

        // ── Security: Block self-settlement ──
        if (debtorId === parsed.data.toUserId) {
            return NextResponse.json({ error: 'Cannot settle with yourself' }, { status: 400 });
        }

        // ── Security: Verify the trip exists and everyone involved is a member ──
        const trip = await prisma.trip.findFirst({
            where: { id: parsed.data.tripId, group: { deletedAt: null } },
            include: {
                group: {
                    include: { members: { select: { userId: true } } },
                },
            },
        });
        if (!trip) return NextResponse.json({ error: 'Trip not found' }, { status: 404 });

        const memberIds = [trip.group.ownerId, ...trip.group.members.map(m => m.userId)];
        if (!memberIds.includes(user.id)) {
            return NextResponse.json({ error: 'You are not a member of this group' }, { status: 403 });
        }
        if (!memberIds.includes(debtorId)) {
            return NextResponse.json({ error: 'Payer is not a member of this group' }, { status: 403 });
        }
        if (!memberIds.includes(parsed.data.toUserId)) {
            return NextResponse.json({ error: 'Recipient is not a member of this group' }, { status: 403 });
        }

        // ── Reuse any in-flight request for the same pair + amount ──
        // Anywhere in the group: balances are the group's, not one trip's.
        const openRequest = await prisma.settlement.findFirst({
            where: {
                trip: { groupId: trip.groupId },
                fromId: debtorId,
                toId: parsed.data.toUserId,
                amount: parsed.data.amount,
                status: { in: ['pending', 'initiated', 'paid_pending'] },
                deletedAt: null,
            },
            include: {
                from: { select: { name: true } },
                to: { select: { name: true } },
                trip: { select: { id: true, title: true, groupId: true } },
            },
            orderBy: { createdAt: 'desc' },
        });

        if (openRequest) {
            return NextResponse.json(openRequest, { status: 200 });
        }

        // ── Security: Duplicate check for recently completed settlements ──
        const sixtySecondsAgo = new Date(Date.now() - 60_000);
        const duplicate = await prisma.settlement.findFirst({
            where: {
                trip: { groupId: trip.groupId },
                fromId: debtorId,
                toId: parsed.data.toUserId,
                amount: parsed.data.amount,
                status: { in: ['completed', 'confirmed'] },
                createdAt: { gte: sixtySecondsAgo },
                deletedAt: null,
            },
        });
        if (duplicate) {
            return NextResponse.json(
                { error: 'This settlement was already completed less than a minute ago.' },
                { status: 409 }
            );
        }

        // ── Security: Over-settlement guard ──
        // Checked against the group's whole ledger (every trip), counting the
        // payments already waiting for approval, in the same serializable
        // transaction as the insert: two taps at once can't both slip through.
        let settlement;
        try {
            settlement = await prisma.$transaction(async (tx) => {
                const ledger = await loadGroupLedger(trip.groupId, tx);
                if (!ledger) throw new SettlementRefused('Group not found', 404);

                const receiverName = ledger.people.get(parsed.data.toUserId)?.name || 'They';
                const fit = settlementRoom(ledger, debtorId, parsed.data.toUserId);
                const refusal = explainTooMuch(fit, parsed.data.amount, receiverName, recordedByReceiver);
                if (refusal) throw new SettlementRefused(refusal);

                return tx.settlement.create({
                    data: {
                        tripId: parsed.data.tripId,
                        fromId: debtorId,
                        toId: parsed.data.toUserId,
                        amount: parsed.data.amount,
                        method: parsed.data.method,
                        note: parsed.data.note,
                        status: 'pending',
                    },
                    include: {
                        from: { select: { name: true } },
                        to: { select: { name: true } },
                        trip: { select: { id: true, title: true, groupId: true } },
                    },
                });
            }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        } catch (error) {
            if (error instanceof SettlementRefused) {
                return NextResponse.json({ error: error.message }, { status: error.status });
            }
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
                return NextResponse.json(
                    { error: 'The group changed at the same moment. Please try again.' },
                    { status: 409 }
                );
            }
            throw error;
        }

        await createAuditLog({
            userId: user.id,
            action: 'create',
            entityType: 'settlement',
            entityId: settlement.id,
            details: {
                groupId: trip.group.id,
                tripId: trip.id,
                status: settlement.status,
                recordedByReceiver,
                after: serializeSettlementAuditSnapshot({
                    id: settlement.id,
                    tripId: settlement.trip.id,
                    tripTitle: settlement.trip.title,
                    fromId: debtorId,
                    fromName: settlement.from.name,
                    toId: parsed.data.toUserId,
                    toName: settlement.to.name,
                    amount: settlement.amount,
                    status: settlement.status,
                    method: settlement.method,
                    note: settlement.note,
                    createdAt: settlement.createdAt,
                    updatedAt: settlement.updatedAt,
                    deletedAt: settlement.deletedAt,
                }),
            },
        });

        // Receivers recording their own receipt are confirmed via
        // /confirm-by-receiver, which notifies the payer — skip the request ping.
        if (!recordedByReceiver) {
            await createNotification({
                userId: parsed.data.toUserId,
                actorId: user.id,
                type: 'group_activity',
                title: 'Settlement request created',
                body: `${user.name || 'Someone'} created a ${parsed.data.method} settlement request for ₹${(parsed.data.amount / 100).toLocaleString('en-IN')}.`,
                link: '/settlements',
            });
        }

        return NextResponse.json(settlement, { status: 201 });
    } catch (error) {
        logger.error('Settlement create error', { err: error });
        return NextResponse.json({ error: 'Failed to record settlement' }, { status: 500 });
    }
}
