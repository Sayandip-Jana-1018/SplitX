import { Prisma } from '@prisma/client';
import { createAuditLog } from '@/lib/auditLog';
import { serializeSettlementAuditSnapshot } from '@/lib/auditPayloads';
import { prisma } from '@/lib/db';
import { loadGroupLedger, settlementRoom, type SettlementRoom } from '@/lib/ledger';
import { recordSettlementCompleted } from '@/lib/metrics';
import { createBulkNotifications, createNotification } from '@/lib/notifications';
import { transitionSettlement, TransitionRefused, type TransitionSettlement } from '@/lib/settlementTransitions';
import { generateUpiLink } from '@/lib/upi';
import { formatCurrency } from '@/lib/utils';

/**
 * Settling up, for every caller: the website's routes under /api/settlements
 * and the phone's under /api/v1/settlements. Each move is one function holding
 * everything it does (the checks, the move, the notifications and the chat
 * line), so a payment made from the phone tells people exactly what one made
 * on the website does (docs/mobile/ROADMAP.md, Phase 2 step 3).
 *
 * A refusal throws TransitionRefused: a sentence for the person, a status, and
 * sometimes a code the app acts on.
 */

type Actor = { id: string; name: string | null };

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

const requestInclude = {
    from: { select: { name: true } },
    to: { select: { name: true } },
    trip: { select: { id: true, title: true, groupId: true } },
} as const;

export type RequestedSettlement = Prisma.SettlementGetPayload<{ include: typeof requestInclude }>;

export interface SettlementRequest {
    tripId: string;
    toUserId: string;
    /** Set when the receiver records a payment made to them (e.g. cash) on the debtor's behalf. */
    fromUserId?: string;
    amount: number;
    method: string;
    note?: string;
}

/**
 * Asks for (or, as the receiver, records) a payment. An identical request
 * still open is answered as it is (`reused`), so a retry never makes two; one
 * completed in the last minute is refused as a duplicate; and the amount must
 * fit the group's balances, checked in the same serializable transaction as
 * the insert, so two taps at once can't both slip through.
 */
export async function requestSettlement(actor: Actor, input: SettlementRequest): Promise<{ settlement: RequestedSettlement; reused: boolean }> {
    const debtorId = input.fromUserId ?? actor.id;
    const recordedByReceiver = debtorId !== actor.id;

    // ── Security: receivers may only record payments made to themselves ──
    if (recordedByReceiver && input.toUserId !== actor.id) {
        throw new TransitionRefused('You can only record payments made to you', 403);
    }

    // ── Security: Block self-settlement ──
    if (debtorId === input.toUserId) {
        throw new TransitionRefused('Cannot settle with yourself', 400);
    }

    // ── Security: Verify the trip exists and everyone involved is a member ──
    const trip = await prisma.trip.findFirst({
        where: { id: input.tripId, group: { deletedAt: null } },
        include: {
            group: {
                include: { members: { select: { userId: true } } },
            },
        },
    });
    if (!trip) throw new TransitionRefused('Trip not found', 404);

    const memberIds = [trip.group.ownerId, ...trip.group.members.map(m => m.userId)];
    if (!memberIds.includes(actor.id)) throw new TransitionRefused('You are not a member of this group', 403);
    if (!memberIds.includes(debtorId)) throw new TransitionRefused('Payer is not a member of this group', 403);
    if (!memberIds.includes(input.toUserId)) throw new TransitionRefused('Recipient is not a member of this group', 403);

    // ── Reuse any in-flight request for the same pair + amount ──
    // Anywhere in the group: balances are the group's, not one trip's.
    const openRequest = await prisma.settlement.findFirst({
        where: {
            trip: { groupId: trip.groupId },
            fromId: debtorId,
            toId: input.toUserId,
            amount: input.amount,
            status: { in: ['pending', 'initiated', 'paid_pending'] },
            deletedAt: null,
        },
        include: requestInclude,
        orderBy: { createdAt: 'desc' },
    });
    if (openRequest) return { settlement: openRequest, reused: true };

    // ── Security: Duplicate check for recently completed settlements ──
    const sixtySecondsAgo = new Date(Date.now() - 60_000);
    const duplicate = await prisma.settlement.findFirst({
        where: {
            trip: { groupId: trip.groupId },
            fromId: debtorId,
            toId: input.toUserId,
            amount: input.amount,
            status: { in: ['completed', 'confirmed'] },
            createdAt: { gte: sixtySecondsAgo },
            deletedAt: null,
        },
    });
    if (duplicate) throw new TransitionRefused('This settlement was already completed less than a minute ago.', 409, 'duplicate');

    // ── Security: Over-settlement guard ──
    // Checked against the group's whole ledger (every trip), counting the
    // payments already waiting for approval, in the same serializable
    // transaction as the insert: two taps at once can't both slip through.
    let settlement: RequestedSettlement;
    try {
        settlement = await prisma.$transaction(async (tx) => {
            const ledger = await loadGroupLedger(trip.groupId, tx);
            if (!ledger) throw new TransitionRefused('Group not found', 404);

            const receiverName = ledger.people.get(input.toUserId)?.name || 'They';
            const fit = settlementRoom(ledger, debtorId, input.toUserId);
            const refusal = explainTooMuch(fit, input.amount, receiverName, recordedByReceiver);
            if (refusal) throw new TransitionRefused(refusal, 400, 'too_much');

            return tx.settlement.create({
                data: {
                    tripId: input.tripId,
                    fromId: debtorId,
                    toId: input.toUserId,
                    amount: input.amount,
                    method: input.method,
                    note: input.note,
                    status: 'pending',
                },
                include: requestInclude,
            });
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
            throw new TransitionRefused('The group changed at the same moment. Please try again.', 409, 'retry');
        }
        throw error;
    }

    await createAuditLog({
        userId: actor.id,
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
                toId: input.toUserId,
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
            userId: input.toUserId,
            actorId: actor.id,
            type: 'group_activity',
            title: 'Settlement request created',
            body: `${actor.name || 'Someone'} created a ${input.method} settlement request for ${formatCurrency(input.amount)}.`,
            link: '/settlements',
        });
    }

    return { settlement, reused: false };
}

/** The payer opens their UPI app: the link to open, and the settlement marked initiated. */
export async function openUpi(actor: Actor, settlementId: string) {
    const { after: settlement } = await transitionSettlement({
        settlementId,
        actorId: actor.id,
        action: 'open_upi',
        data: { method: 'upi' },
        guard: (current) => {
            if (!current.to.upiId) {
                throw new TransitionRefused(
                    `${current.to.name || 'The recipient'} hasn't added their UPI ID yet. Ask them to add it in Settings → Payment.`,
                    400,
                    'no_upi_id'
                );
            }
        },
    });
    const upiId = settlement.to.upiId as string;
    const upiUrl = generateUpiLink({
        upiId,
        payeeName: settlement.to.name || 'SplitIT User',
        amount: settlement.amount / 100,
        note: 'SplitIT settlement',
    });
    return { settlement, upiUrl, upiId };
}

/** The payer says "I've paid"; the receiver is asked to approve it. */
export async function markPaid(actor: Actor, settlementId: string, options: { cash?: boolean; utrNumber?: string } = {}): Promise<TransitionSettlement> {
    const { cash = false, utrNumber } = options;
    const { after: settlement } = await transitionSettlement({
        settlementId,
        actorId: actor.id,
        action: 'mark_paid',
        data: { method: cash ? 'cash' : 'upi', ...(utrNumber ? { utrNumber } : {}) },
    });
    await createNotification({
        userId: settlement.toId,
        actorId: actor.id,
        type: 'settlement_approval_request',
        title: 'Payment approval needed',
        body: `${settlement.from.name || 'Someone'} says they paid you ${formatCurrency(settlement.amount)}${cash ? ' in cash' : ''}. Approve it once you receive the money${utrNumber ? ` (UTR: ${utrNumber})` : ''}.`,
        link: '/settlements',
    });
    return settlement;
}

/**
 * The receiver approves a payment marked paid (it completes, the group is told
 * and the chat says so), or sends it back to the payer.
 */
export async function decideApproval(actor: Actor, settlementId: string, approving: boolean): Promise<TransitionSettlement> {
    const { after: settlement } = await transitionSettlement({
        settlementId,
        actorId: actor.id,
        action: approving ? 'approve' : 'send_back',
    });
    const amount = formatCurrency(settlement.amount);

    if (!approving) {
        await createNotification({
            userId: settlement.fromId,
            actorId: actor.id,
            type: 'settlement_rejected',
            title: 'Payment still needs approval',
            body: `${settlement.to.name || 'The receiver'} has not approved your ${amount} payment yet. Please verify and try again.`,
            link: '/settlements',
        });
        return settlement;
    }

    recordSettlementCompleted(settlement.method, settlement.amount);
    await createNotification({
        userId: settlement.fromId,
        actorId: actor.id,
        type: 'settlement_completed',
        title: 'Payment approved',
        body: `${settlement.to.name || 'Someone'} confirmed receiving ${amount} from you.`,
        link: '/settlements',
    });

    try {
        const group = await prisma.group.findUnique({
            where: { id: settlement.trip.groupId },
            include: { members: { select: { userId: true } } },
        });
        const otherMemberIds = (group?.members ?? [])
            .map((member) => member.userId)
            .filter((memberId) => memberId !== settlement.fromId && memberId !== settlement.toId);

        if (otherMemberIds.length > 0) {
            await createBulkNotifications(otherMemberIds, {
                actorId: actor.id,
                type: 'settlement_completed',
                title: 'Settlement completed',
                body: `${settlement.to.name || 'Someone'} approved ${amount} from ${settlement.from.name || 'someone'}.`,
                link: '/settlements',
            });
        }
    } catch {
        // non-fatal
    }

    await prisma.groupMessage.create({
        data: {
            groupId: settlement.trip.groupId,
            senderId: actor.id,
            type: 'system',
            content: `✅ ${settlement.to.name || 'Someone'} confirmed receiving ${formatCurrency(settlement.amount)} from ${settlement.from.name || 'someone'}.`,
            settlementId: settlement.id,
        },
    });
    return settlement;
}

export type ReceiverRecord = 'confirm' | 'accept_cash' | 'reject';

const RECEIVER_MOVES = { confirm: 'mark_received', accept_cash: 'accept_cash', reject: 'decline' } as const;

/**
 * The receiver records what happened: the payer has paid and it only needs
 * approving, they were handed cash (completed), or it was never paid (cancelled).
 */
export async function receiverRecords(actor: Actor, settlementId: string, record: ReceiverRecord): Promise<TransitionSettlement> {
    const { after: settlement } = await transitionSettlement({
        settlementId,
        actorId: actor.id,
        action: RECEIVER_MOVES[record],
        ...(record === 'accept_cash' ? { data: { method: 'cash' } } : {}),
    });

    if (record === 'reject') {
        try {
            await createNotification({
                userId: settlement.fromId,
                type: 'settlement_rejected',
                title: 'Settlement Rejected',
                body: `${settlement.to.name || 'The receiver'} marked your ${formatCurrency(settlement.amount)} payment as not received`,
                link: '/settlements',
            });
        } catch { /* notification failures are non-critical */ }
    }

    if (record === 'accept_cash') {
        recordSettlementCompleted('cash', settlement.amount);
        try {
            await createNotification({
                userId: settlement.fromId,
                type: 'settlement_completed',
                title: 'Settlement Completed',
                body: `${settlement.to.name || 'The receiver'} confirmed receiving ${formatCurrency(settlement.amount)} in cash`,
                link: '/settlements',
            });
        } catch { /* notification failures are non-critical */ }
    }
    return settlement;
}
