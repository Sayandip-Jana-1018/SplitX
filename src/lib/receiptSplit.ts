import { equalSharesById } from './splits';

/**
 * Splitting a scanned bill by item, in whole paise.
 *
 * Each item's price (its row total, as printed) is shared equally by the people
 * who had it, the leftover paisa placed as in any equal split. Everything else
 * on the bill (taxes, a service charge, a discount, the round-off) is the gap
 * between the items and the printed total, and is shared in proportion to what
 * each person had. The shares add up to the printed total exactly, because
 * that is what was paid.
 */

export interface ReceiptLine {
    name: string;
    quantity: number;
    /** The row's total in paise (quantity × unit price), as printed. */
    price: number;
}

export interface ReceiptSplit {
    /** Each person's share, in the group's member order, leaving out anyone at zero. */
    shares: { userId: string; amount: number }[];
    /** What the shares add up to: the printed total, or items plus taxes when none was read. */
    total: number;
    itemsTotal: number;
    taxTotal: number;
    /** The rest of the bill: a discount or round-off when negative, charges not listed when positive. */
    adjustment: number;
}

/**
 * Parts of `amount` in proportion to `weights` (whole numbers, at least one
 * above zero) that add up to `amount` exactly: each part rounded down, then the
 * leftover paise one each to the largest remainders, the earlier on a tie.
 */
export function apportion(amount: number, weights: readonly number[]): number[] {
    const sum = BigInt(weights.reduce((total, weight) => total + weight, 0));
    if (sum <= BigInt(0)) throw new RangeError('apportion needs a weight above zero');
    // BigInt: a ₹10,00,000 bill times a weight of the same size passes 2^53.
    const exact = weights.map((weight) => BigInt(amount) * BigInt(weight));
    const parts = exact.map((value) => Number(value / sum));
    let left = amount - parts.reduce((total, part) => total + part, 0);
    const byRemainder = exact
        .map((value, index) => ({ index, remainder: value % sum }))
        .sort((a, b) => (a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1));
    for (const { index } of byRemainder) {
        if (left === 0) break;
        parts[index] += 1;
        left -= 1;
    }
    return parts;
}

/**
 * Whether the rest of the bill is big enough that an item was probably misread:
 * over ₹5 and over 5% of the total.
 */
export function adjustmentLooksWrong(adjustment: number, total: number): boolean {
    return Math.abs(adjustment) > 500 && Math.abs(adjustment) > total * 0.05;
}

const isPaise = (value: number) => Number.isSafeInteger(value) && value >= 0;

/**
 * The split, or null while an item has nobody, or when the bill can't be split
 * (no positive total, or amounts that aren't whole non-negative paise).
 */
export function splitReceipt({ items, taxes, total, assignments, memberIds }: {
    items: readonly ReceiptLine[];
    taxes: Readonly<Record<string, number>>;
    /** The printed total in paise; 0 when none was read. */
    total: number;
    /** For each item, who had it. */
    assignments: readonly (readonly string[])[];
    /** The group's members, in the order the shares are listed. */
    memberIds: readonly string[];
}): ReceiptSplit | null {
    if (items.length === 0 || assignments.length !== items.length) return null;
    if (!items.every((item) => isPaise(item.price)) || !isPaise(total)) return null;

    const had = new Map(memberIds.map((id) => [id, 0]));
    for (const [index, item] of items.entries()) {
        const people = assignments[index].filter((id) => had.has(id));
        if (people.length === 0) return null;
        for (const [userId, share] of equalSharesById(item.price, people)) had.set(userId, had.get(userId)! + share);
    }

    const itemsTotal = items.reduce((sum, item) => sum + item.price, 0);
    const taxTotal = Object.values(taxes).reduce((sum, tax) => sum + tax, 0);
    const billTotal = total > 0 ? total : itemsTotal + taxTotal;
    if (!(billTotal > 0) || !Number.isSafeInteger(billTotal)) return null;

    const involved = memberIds.filter((id) => assignments.some((people) => people.includes(id)));
    const weights = involved.map((id) => had.get(id)!);
    // Only free items: nothing to be proportional to, so everyone involved pays alike.
    const amounts = apportion(billTotal, weights.some((weight) => weight > 0) ? weights : weights.map(() => 1));

    return {
        shares: involved.map((userId, index) => ({ userId, amount: amounts[index] })).filter((share) => share.amount > 0),
        total: billTotal,
        itemsTotal,
        taxTotal,
        adjustment: billTotal - itemsTotal - taxTotal,
    };
}
