import { prisma } from '@/lib/db';
import type { Expense, NewExpense } from '@/lib/contract/v1';
import { createExpense, deleteExpense, type CreatedExpense } from '@/lib/services/expenses';

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
