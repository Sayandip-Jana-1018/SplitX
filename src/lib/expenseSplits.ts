import { equalSharesById } from '@/lib/splits';

/**
 * The rules every expense's shares obey, whether the expense is being created
 * or edited: shares go only to current members, each member at most once,
 * and they add up to the expense exactly — to the paisa.
 *
 * Creating and editing used to check different things (an edit could save an
 * amount its shares no longer added up to, or charge someone outside the
 * group). Both now call `resolveSplits`, so there is one set of rules.
 */

/** ₹10,00,000. The amount columns are 32-bit integers (about ₹2.1 crore); this keeps far inside them. */
export const MAX_EXPENSE_PAISE = 100_000_000;

export const SPLIT_TYPES = ['equal', 'percentage', 'custom'] as const;
export type SplitType = (typeof SPLIT_TYPES)[number];

interface ShareInput {
    userId: string;
    amount: number;
}

export interface SplitRequest {
    amount: number;
    splitType: SplitType;
    /** Equal splits: who shares the expense. Omitted or empty means every member. */
    splitAmong?: readonly string[];
    /** Percentage and custom splits: what each person owes, in paise. */
    splits?: readonly ShareInput[];
}

export type SplitResolution =
    | { ok: true; splits: ShareInput[] }
    | { ok: false; error: string };

const fail = (error: string): SplitResolution => ({ ok: false, error });

function findDuplicate(userIds: readonly string[]) {
    const seen = new Set<string>();
    for (const userId of userIds) {
        if (seen.has(userId)) return userId;
        seen.add(userId);
    }
    return null;
}

/**
 * Works out the shares for an expense, or says exactly why it can't.
 * `memberIds` are the group's current members.
 */
export function resolveSplits(request: SplitRequest, memberIds: readonly string[]): SplitResolution {
    const { amount, splitType } = request;
    if (!Number.isSafeInteger(amount) || amount <= 0) return fail('The amount must be a positive whole number of paise');
    if (amount > MAX_EXPENSE_PAISE) return fail('An expense can be at most ₹10,00,000');

    const members = new Set(memberIds);

    if (splitType === 'equal') {
        const requested = request.splitAmong && request.splitAmong.length > 0 ? request.splitAmong : memberIds;
        const duplicate = findDuplicate(requested);
        if (duplicate) return fail('Each member can appear only once in a split');
        const outsider = requested.find((userId) => !members.has(userId));
        if (outsider) return fail('Everyone in the split must be a current member of the group');
        if (requested.length === 0) return fail('At least one member must be included in the split');
        const shares = equalSharesById(amount, requested);
        return { ok: true, splits: [...shares].map(([userId, share]) => ({ userId, amount: share })) };
    }

    const splits = request.splits ?? [];
    if (splits.length === 0) return fail(`A ${splitType} split needs the amount each member owes`);
    if (findDuplicate(splits.map((split) => split.userId))) return fail('Each member can appear only once in a split');
    if (splits.some((split) => !members.has(split.userId))) {
        return fail('Everyone in the split must be a current member of the group');
    }
    if (splits.some((split) => !Number.isSafeInteger(split.amount) || split.amount < 0)) {
        return fail('Each share must be a whole, non-negative number of paise');
    }
    const total = splits.reduce((sum, split) => sum + split.amount, 0);
    if (total !== amount) {
        return fail(`Split amounts (${total}) must equal the transaction total (${amount})`);
    }
    return { ok: true, splits: splits.map(({ userId, amount: share }) => ({ userId, amount: share })) };
}
