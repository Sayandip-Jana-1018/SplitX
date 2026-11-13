import { prisma } from '@/lib/db';
import type { ChatMessage, Expense, MessagePage, NewExpense, NewMessage, NewSettlement, Settlement, SettlementMove } from '@/lib/contract/v1';
import { createExpense, deleteExpense, type CreatedExpense } from '@/lib/services/expenses';
import { ChatRefused, listGroupMessages, sendGroupMessage, type ChatMessageRow } from '@/lib/services/groupChat';
import { decideApproval, markPaid, openUpi, receiverRecords, requestSettlement } from '@/lib/services/settlements';
import { TransitionRefused } from '@/lib/settlementTransitions';

/**
 * What the phone app changes (docs/mobile/ROADMAP.md, Phase 2 step 3), through
 * the same services the website uses (src/lib/services).
 */

export type WriteOutcome<T> = { ok: true; value: T } | { ok: false; status: number; error: string; code: string };

async function actorOf(userId: string) {
    return prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true } });
}

function expenseOf(expense: CreatedExpense, groupId: string): Expense {
    return {
        id: expense.id,
        groupId,
        title: expense.title,
        amount: expense.amount,
        category: expense.category,
        payerId: expense.payerId,
        splitType: expense.splitType,
        splits: expense.splits.map((split) => ({ userId: split.userId, amount: split.amount })),
        createdAt: expense.createdAt.toISOString(),
    };
}

/**
 * Saves an expense in a group you're in, on its current trip: the newest active
 * one, else the newest (as the website does). The phone's clientId is the key.
 */
export async function saveExpense(userId: string, input: NewExpense): Promise<WriteOutcome<{ expense: Expense; replayed: boolean }>> {
    const actor = await actorOf(userId);
    if (!actor) return { ok: false, status: 401, error: 'Your session has ended. Sign in again.', code: 'unauthenticated' };

    const trip = await prisma.trip.findFirst({
        where: { group: { id: input.groupId, deletedAt: null, OR: [{ ownerId: userId }, { members: { some: { userId } } }] } },
        orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
        select: { id: true },
    });
    if (!trip) return { ok: false, status: 404, error: 'That group isn’t here.', code: 'not_found' };

    const outcome = await createExpense(
        actor,
        {
            tripId: trip.id,
            title: input.title,
            amount: input.amount,
            category: input.category,
            method: 'cash',
            payerId: input.payerId,
            splitType: input.splitType,
            splitAmong: input.splitAmong,
            splits: input.splits,
        },
        `${userId}:${input.clientId}`,
    );
    if (!outcome.ok) return outcome;
    return { ok: true, value: { expense: expenseOf(outcome.expense, input.groupId), replayed: outcome.replayed } };
}

/** Deletes an expense you paid, or one in a group you own. */
export async function removeExpense(userId: string, expenseId: string): Promise<WriteOutcome<null>> {
    const actor = await actorOf(userId);
    if (!actor) return { ok: false, status: 401, error: 'Your session has ended. Sign in again.', code: 'unauthenticated' };
    const outcome = await deleteExpense(actor, expenseId);
    return outcome.ok ? { ok: true, value: null } : { ok: false, status: 404, error: 'That expense isn’t here, or isn’t yours to delete.', code: 'not_found' };
}

// ── Settling up ─────────────────────────────────────────────

type SettlementLike = { id: string; fromId: string; toId: string; amount: number; status: string; method: string | null; note: string | null; createdAt: Date; trip: { groupId: string } };

function settlementOf(settlement: SettlementLike): Settlement {
    return {
        id: settlement.id,
        groupId: settlement.trip.groupId,
        fromId: settlement.fromId,
        toId: settlement.toId,
        amount: settlement.amount,
        status: settlement.status,
        method: settlement.method,
        note: settlement.note,
        createdAt: settlement.createdAt.toISOString(),
    };
}

function refused(error: unknown): WriteOutcome<never> | null {
    if (error instanceof TransitionRefused) return { ok: false, status: error.status, error: error.message, code: error.code ?? (error.status === 404 ? 'not_found' : 'refused') };
    return null;
}

/** Asks for a payment in a group you're in (or records one made to you), on its current trip. */
export async function askSettlement(userId: string, input: NewSettlement): Promise<WriteOutcome<{ settlement: Settlement; reused: boolean }>> {
    const actor = await actorOf(userId);
    if (!actor) return { ok: false, status: 401, error: 'Your session has ended. Sign in again.', code: 'unauthenticated' };
    const trip = await prisma.trip.findFirst({
        where: { group: { id: input.groupId, deletedAt: null, OR: [{ ownerId: userId }, { members: { some: { userId } } }] } },
        orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
        select: { id: true },
    });
    if (!trip) return { ok: false, status: 404, error: 'That group isn’t here.', code: 'not_found' };
    try {
        const { settlement, reused } = await requestSettlement(actor, { ...input, tripId: trip.id });
        return { ok: true, value: { settlement: settlementOf(settlement), reused } };
    } catch (error) {
        const answer = refused(error);
        if (answer) return answer;
        throw error;
    }
}

/** One step of a settlement, by whichever side it belongs to. */
export async function moveSettlement(userId: string, settlementId: string, move: SettlementMove): Promise<WriteOutcome<{ settlement: Settlement; upiUrl: string | null }>> {
    const actor = await actorOf(userId);
    if (!actor) return { ok: false, status: 401, error: 'Your session has ended. Sign in again.', code: 'unauthenticated' };
    try {
        switch (move.action) {
            case 'open_upi': {
                const { settlement, upiUrl } = await openUpi(actor, settlementId);
                return { ok: true, value: { settlement: settlementOf(settlement), upiUrl } };
            }
            case 'mark_paid':
                return { ok: true, value: { settlement: settlementOf(await markPaid(actor, settlementId, { cash: move.cash, utrNumber: move.utrNumber || undefined })), upiUrl: null } };
            case 'approve':
            case 'send_back':
                return { ok: true, value: { settlement: settlementOf(await decideApproval(actor, settlementId, move.action === 'approve')), upiUrl: null } };
            case 'mark_received':
            case 'accept_cash':
            case 'decline': {
                const record = move.action === 'mark_received' ? 'confirm' : move.action === 'accept_cash' ? 'accept_cash' : 'reject';
                return { ok: true, value: { settlement: settlementOf(await receiverRecords(actor, settlementId, record)), upiUrl: null } };
            }
        }
    } catch (error) {
        const answer = refused(error);
        if (answer) return answer;
        throw error;
    }
}

// ── Chat ────────────────────────────────────────────────────

function chatMessageOf(message: ChatMessageRow): ChatMessage {
    return {
        id: message.id,
        senderId: message.senderId,
        senderName: message.sender.name,
        type: message.type,
        content: message.content,
        settlementId: message.settlementId,
        transactionId: message.transactionId,
        createdAt: message.createdAt.toISOString(),
    };
}

/** A page of a group's chat, or null if you aren't in the group. */
export async function readMessages(userId: string, groupId: string, page: { cursor?: string | null; limit: number }): Promise<MessagePage | null> {
    const answer = await listGroupMessages(userId, groupId, page);
    return answer ? { messages: answer.messages.map(chatMessageOf), nextCursor: answer.nextCursor } : null;
}

/** Sends a message to a group you're in. */
export async function postMessage(userId: string, groupId: string, input: NewMessage): Promise<WriteOutcome<{ message: ChatMessage }>> {
    const actor = await actorOf(userId);
    if (!actor) return { ok: false, status: 401, error: 'Your session has ended. Sign in again.', code: 'unauthenticated' };
    try {
        return { ok: true, value: { message: chatMessageOf(await sendGroupMessage(actor, groupId, input)) } };
    } catch (error) {
        if (error instanceof ChatRefused) return { ok: false, status: error.status === 403 ? 404 : error.status, error: error.status === 403 ? 'That group isn’t here.' : error.message, code: error.status === 403 ? 'not_found' : error.code };
        throw error;
    }
}
