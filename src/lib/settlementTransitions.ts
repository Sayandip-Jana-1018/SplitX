import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { createAuditLog } from '@/lib/auditLog';
import { serializeSettlementAuditSnapshot } from '@/lib/auditPayloads';
import { loadGroupLedger, settlementRoom } from '@/lib/ledger';
import { isCompletedSettlementStatus } from '@/lib/settlementStatus';
import { formatCurrency } from '@/lib/utils';

/**
 * Every move a settlement can make, in one table.
 *
 *   pending ──open_upi──▶ initiated ──mark_paid──▶ paid_pending ──approve──▶ completed
 *      │                      │                        │
 *      └──── accept_cash, decline (receiver) ──────────┴──send_back──▶ initiated
 *
 * A move is allowed only for the person it names and only from the states it
 * lists. It lands only if the settlement is still in the state that was read,
 * so of two taps at once exactly one wins, and a cancelled or completed
 * settlement never moves again. Every move is written to the audit log.
 *
 * The payer's moves come before money leaves their account, so they re-check
 * the group's balances: a request made before an expense changed can't be paid
 * at its old amount. The receiver's moves record money that has already moved,
 * so they are recorded as they happened.
 */

type Role = 'payer' | 'receiver';

interface Transition {
    by: Role;
    from: readonly string[];
    to: string;
    /** Re-check the balances before money moves. */
    checksBalance?: boolean;
}

export const SETTLEMENT_TRANSITIONS = {
    /** The payer opens their UPI app. */
    open_upi: { by: 'payer', from: ['pending', 'initiated'], to: 'initiated', checksBalance: true },
    /** The payer says they have paid; the receiver still has to approve. */
    mark_paid: { by: 'payer', from: ['pending', 'initiated'], to: 'paid_pending', checksBalance: true },
    /** The receiver confirms the money arrived. */
    approve: { by: 'receiver', from: ['paid_pending'], to: 'completed' },
    /** The receiver hasn't seen the money yet: back to the payer. */
    send_back: { by: 'receiver', from: ['paid_pending'], to: 'initiated' },
    /** The receiver says the payer has paid, before the payer did. */
    mark_received: { by: 'receiver', from: ['pending', 'initiated'], to: 'paid_pending' },
    /** The receiver was handed cash. */
    accept_cash: { by: 'receiver', from: ['pending', 'initiated', 'paid_pending'], to: 'completed' },
    /** The receiver says it was never paid. */
    decline: { by: 'receiver', from: ['pending', 'initiated', 'paid_pending'], to: 'cancelled' },
} as const satisfies Record<string, Transition>;

export type SettlementAction = keyof typeof SETTLEMENT_TRANSITIONS;

export class TransitionRefused extends Error {
    constructor(message: string, readonly status: number, readonly code?: string) {
        super(message);
    }
}

const settlementInclude = {
    from: { select: { id: true, name: true, upiId: true } },
    to: { select: { id: true, name: true, upiId: true } },
    trip: { select: { id: true, title: true, groupId: true } },
} as const;

export type TransitionSettlement = Prisma.SettlementGetPayload<{ include: typeof settlementInclude }>;

function refusalFor(status: string, action: SettlementAction) {
    if (isCompletedSettlementStatus(status)) return 'This payment has already been completed.';
    if (status === 'cancelled') return 'This request was marked as not paid. Start a new one from Settle Up.';
    if (status === 'paid_pending') return 'This payment is already waiting for the receiver to approve it.';
    if (action === 'approve' || action === 'send_back') return 'This payment hasn’t been marked as paid yet.';
    return 'This payment can’t do that from where it is now.';
}

/**
 * Moves a settlement one step, or throws TransitionRefused saying why not.
 * `guard` runs on the settlement as read, before anything is written.
 */
export async function transitionSettlement(params: {
    settlementId: string;
    actorId: string;
    action: SettlementAction;
    data?: { method?: string; utrNumber?: string };
    guard?: (settlement: TransitionSettlement) => void;
}): Promise<{ before: TransitionSettlement; after: TransitionSettlement }> {
    const rule: Transition = SETTLEMENT_TRANSITIONS[params.action];

    const run = async (tx: Prisma.TransactionClient) => {
        const before = await tx.settlement.findFirst({
            where: { id: params.settlementId, deletedAt: null, trip: { group: { deletedAt: null } } },
            include: settlementInclude,
        });
        if (!before) throw new TransitionRefused('Settlement not found', 404);

        const role: Role | null = before.fromId === params.actorId ? 'payer' : before.toId === params.actorId ? 'receiver' : null;
        if (role !== rule.by) {
            throw new TransitionRefused(
                rule.by === 'payer' ? 'Only the person who owes can do this.' : 'Only the person being paid can do this.',
                403
            );
        }
        if (!rule.from.includes(before.status)) {
            throw new TransitionRefused(refusalFor(before.status, params.action), 409);
        }
        params.guard?.(before);

        if (rule.checksBalance) {
            const ledger = await loadGroupLedger(before.trip.groupId, tx);
            const fit = ledger ? settlementRoom(ledger, before.fromId, before.toId, before.id) : null;
            if (!fit || before.amount > fit.room) {
                throw new TransitionRefused(
                    `Balances have changed since this request was made. It is for ${formatCurrency(before.amount)}, `
                    + `and ${formatCurrency(fit?.room ?? 0)} is left to settle between you now. `
                    + `Ask ${before.to.name || 'them'} to mark it as not paid, then settle the new amount.`,
                    409,
                    'balance_changed'
                );
            }
        }

        const written = await tx.settlement.updateMany({
            where: { id: before.id, status: before.status, deletedAt: null },
            data: { status: rule.to, ...params.data },
        });
        if (written.count !== 1) {
            throw new TransitionRefused('This payment changed at the same moment. Refresh and try again.', 409);
        }

        const after = await tx.settlement.findUniqueOrThrow({ where: { id: before.id }, include: settlementInclude });
        return { before, after };
    };

    let result: { before: TransitionSettlement; after: TransitionSettlement };
    try {
        result = rule.checksBalance
            ? await prisma.$transaction(run, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
            : await prisma.$transaction(run);
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
            throw new TransitionRefused('This group changed at the same moment. Please try again.', 409);
        }
        throw error;
    }

    await createAuditLog({
        userId: params.actorId,
        action: 'update',
        entityType: 'settlement',
        entityId: result.after.id,
        details: {
            groupId: result.after.trip.groupId,
            tripId: result.after.tripId,
            transition: params.action,
            before: snapshot(result.before),
            after: snapshot(result.after),
        },
    });

    return result;
}

function snapshot(settlement: TransitionSettlement) {
    return serializeSettlementAuditSnapshot({
        id: settlement.id,
        tripId: settlement.tripId,
        tripTitle: settlement.trip.title,
        fromId: settlement.fromId,
        fromName: settlement.from.name,
        toId: settlement.toId,
        toName: settlement.to.name,
        amount: settlement.amount,
        status: settlement.status,
        method: settlement.method,
        note: settlement.note,
        createdAt: settlement.createdAt,
        updatedAt: settlement.updatedAt,
        deletedAt: settlement.deletedAt,
    });
}

/** A settlement's own fields, for a response: without either person's UPI ID. */
export function settlementRow(settlement: TransitionSettlement) {
    return {
        id: settlement.id,
        tripId: settlement.tripId,
        fromId: settlement.fromId,
        toId: settlement.toId,
        amount: settlement.amount,
        status: settlement.status,
        method: settlement.method,
        note: settlement.note,
        utrNumber: settlement.utrNumber,
        createdAt: settlement.createdAt,
        updatedAt: settlement.updatedAt,
    };
}

/** The answer a route gives for a refused move: the reason, and a code when the page acts on it. */
export function refusalResponse(error: TransitionRefused) {
    return NextResponse.json(
        { error: error.message, ...(error.code ? { code: error.code } : {}) },
        { status: error.status }
    );
}
