/**
 * Settle-up planning: the fewest payments that clear a set of balances.
 *
 * Amounts are whole paise. A positive balance is owed money; a negative
 * balance owes it.
 *
 * Any plan splits people into groups whose balances sum to zero, and a group
 * of k people settles in k − 1 payments. The fewest payments therefore means
 * the most zero-sum groups — a subset-sum problem, NP-hard in general. The
 * planner:
 *
 * 1. pairs exact opposites (one person owes exactly what another is owed),
 *    which never costs optimality;
 * 2. solves what remains exactly, by dynamic programming over subsets, when
 *    at most `exactLimit` people are left — every real friend group;
 * 3. otherwise looks for zero-sum triples within a fixed work budget and
 *    settles the rest largest-first;
 * 4. keeps the largest-first plan SplitX has always shown unless that plan
 *    needs more payments, so a group's plan only changes when a payment is saved.
 */

export interface AccountBalance {
    id: string;
    amount: number;
}

export interface PlannedTransfer {
    from: string;
    to: string;
    amount: number;
}

type PlanAlgorithm = 'greedy' | 'exact' | 'heuristic';

export interface SettlementPlan {
    transfers: PlannedTransfer[];
    /** What produced `transfers`: `greedy` when nothing needed fewer payments. */
    algorithm: PlanAlgorithm;
    /** True when the exact solver proved no plan needs fewer payments. */
    optimal: boolean;
    /** Payments the largest-first algorithm needs for the same balances. */
    greedyTransferCount: number;
}

export interface PlanOptions {
    /** Balances within ±tolerance paise count as settled. */
    tolerance?: number;
    /** Most people left after pairing that are solved exactly. Cost grows as 2ⁿ·n. */
    exactLimit?: number;
    /** Most candidate checks spent looking for zero-sum triples in larger groups. */
    tripleBudget?: number;
}

const DEFAULT_EXACT_LIMIT = 16;
/** Hard ceiling: the exact solver allocates 9 bytes per subset (2ⁿ subsets). */
const MAX_EXACT_LIMIT = 20;
const DEFAULT_TRIPLE_BUDGET = 4_000_000;

interface Party {
    id: string;
    /** Always positive: how much this person owes, or is owed. */
    amount: number;
}

export function planSettlement(accounts: readonly AccountBalance[], options: PlanOptions = {}): SettlementPlan {
    const tolerance = options.tolerance ?? 0;
    const exactLimit = Math.min(options.exactLimit ?? DEFAULT_EXACT_LIMIT, MAX_EXACT_LIMIT);
    const tripleBudget = options.tripleBudget ?? DEFAULT_TRIPLE_BUDGET;

    let residual = 0;
    for (const { amount } of accounts) {
        if (!Number.isSafeInteger(amount)) throw new RangeError('Balances must be whole paise');
        if (Math.abs(amount) > tolerance) residual += amount;
    }

    const greedy = greedyPlan(accounts, tolerance);
    const open = accounts.filter(({ amount }) => Math.abs(amount) > tolerance);
    const { transfers: paired, rest } = pairOpposites(open);
    const exact = rest.length <= exactLimit;
    const planned = paired.concat(exact ? planExactly(rest) : planHeuristically(rest, tripleBudget));

    // Without a zero sum there is no complete settlement to be optimal about.
    const optimal = exact && residual === 0;
    if (planned.length < greedy.length) {
        return { transfers: planned, algorithm: exact ? 'exact' : 'heuristic', optimal, greedyTransferCount: greedy.length };
    }
    return { transfers: greedy, algorithm: 'greedy', optimal, greedyTransferCount: greedy.length };
}

/** Largest debtor pays largest creditor, repeatedly: at most n − 1 payments. */
export function greedyPlan(accounts: readonly AccountBalance[], tolerance = 0): PlannedTransfer[] {
    const debtors: Party[] = [];
    const creditors: Party[] = [];
    for (const { id, amount } of accounts) {
        if (amount < -tolerance) debtors.push({ id, amount: -amount });
        else if (amount > tolerance) creditors.push({ id, amount });
    }
    return settleLargestFirst(debtors, creditors);
}

function settleLargestFirst(debtors: Party[], creditors: Party[]): PlannedTransfer[] {
    debtors.sort((a, b) => b.amount - a.amount);
    creditors.sort((a, b) => b.amount - a.amount);

    const transfers: PlannedTransfer[] = [];
    let d = 0;
    let c = 0;
    while (d < debtors.length && c < creditors.length) {
        const amount = Math.min(debtors[d].amount, creditors[c].amount);
        if (amount > 0) transfers.push({ from: debtors[d].id, to: creditors[c].id, amount });
        debtors[d].amount -= amount;
        creditors[c].amount -= amount;
        if (debtors[d].amount < 1) d += 1;
        if (creditors[c].amount < 1) c += 1;
    }
    return transfers;
}

/** Everyone in a group pays or is paid within it (largest-first). */
function settleGroup(group: readonly AccountBalance[]): PlannedTransfer[] {
    return greedyPlan(group);
}

/**
 * One payment for each pair of exact opposites. Some optimal plan always
 * contains that payment: if x and −x sit in different zero-sum groups, swapping
 * them into a pair of their own leaves two zero-sum groups; if they share one,
 * splitting the pair off adds a group.
 */
function pairOpposites(accounts: readonly AccountBalance[]) {
    const waiting = new Map<number, number[]>();
    const paired = new Uint8Array(accounts.length);
    const transfers: PlannedTransfer[] = [];

    for (let index = 0; index < accounts.length; index++) {
        const { amount } = accounts[index];
        const opposite = waiting.get(-amount);
        if (opposite && opposite.length > 0) {
            const other = opposite.pop()!;
            paired[index] = 1;
            paired[other] = 1;
            const [debtor, creditor] = amount < 0 ? [accounts[index], accounts[other]] : [accounts[other], accounts[index]];
            transfers.push({ from: debtor.id, to: creditor.id, amount: creditor.amount });
        } else {
            const list = waiting.get(amount);
            if (list) list.push(index);
            else waiting.set(amount, [index]);
        }
    }

    return { transfers, rest: accounts.filter((_, index) => !paired[index]) };
}

/**
 * Exact: the most zero-sum groups the people can be split into.
 *
 * Remove people one at a time; every time the people still left sum to zero,
 * the ones removed since the previous such moment form a zero-sum group. For
 * each subset, `groups[subset]` is the most such moments over any removal
 * order — the best order removes whoever leaves the best remainder. The
 * removal order that achieves the maximum is then replayed to build the plan.
 */
function planExactly(accounts: readonly AccountBalance[]): PlannedTransfer[] {
    const n = accounts.length;
    if (n < 2) return [];

    const everyone = (1 << n) - 1;
    const sums = new Float64Array(everyone + 1);
    const groups = new Uint8Array(everyone + 1);

    for (let subset = 1; subset <= everyone; subset++) {
        const lowest = subset & -subset;
        sums[subset] = sums[subset ^ lowest] + accounts[31 - Math.clz32(lowest)].amount;

        let best = 0;
        for (let bits = subset; bits !== 0; bits &= bits - 1) {
            const remainder = groups[subset ^ (bits & -bits)];
            if (remainder > best) best = remainder;
        }
        groups[subset] = best + (sums[subset] === 0 ? 1 : 0);
    }

    const transfers: PlannedTransfer[] = [];
    let group: AccountBalance[] = [];
    let subset = everyone;
    for (;;) {
        // The first group closed is the remainder when the balances don't sum
        // to zero; largest-first settles as much of it as possible.
        if (sums[subset] === 0 && group.length > 0) {
            transfers.push(...settleGroup(group));
            group = [];
        }
        if (subset === 0) break;

        const target = groups[subset] - (sums[subset] === 0 ? 1 : 0);
        let bits = subset;
        while (bits !== 0 && groups[subset ^ (bits & -bits)] !== target) bits &= bits - 1;
        // Unreachable when the table is consistent; never spin a pod's CPU on a bug.
        if (bits === 0) throw new Error('Settlement planner found no removal matching its table');
        const removed = bits & -bits;
        group.push(accounts[31 - Math.clz32(removed)]);
        subset ^= removed;
    }
    return transfers;
}

/**
 * Large groups: settle zero-sum triples (two people exactly cover a third) with
 * two payments each, then everyone else largest-first. Bounded by `budget`
 * candidate checks so a request can't run away with the CPU.
 */
function planHeuristically(accounts: readonly AccountBalance[], budget: number): PlannedTransfer[] {
    const debtors: Party[] = [];
    const creditors: Party[] = [];
    for (const { id, amount } of accounts) {
        if (amount < 0) debtors.push({ id, amount: -amount });
        else creditors.push({ id, amount });
    }

    const work = { left: budget };
    const transfers: PlannedTransfer[] = [];
    const settled = new Set<Party>();

    for (const [creditor, first, second] of findTriples(creditors, debtors, work)) {
        transfers.push({ from: first.id, to: creditor.id, amount: first.amount });
        transfers.push({ from: second.id, to: creditor.id, amount: second.amount });
        settled.add(creditor).add(first).add(second);
    }
    const openDebtors = debtors.filter((party) => !settled.has(party));
    const openCreditors = creditors.filter((party) => !settled.has(party));

    for (const [debtor, first, second] of findTriples(openDebtors, openCreditors, work)) {
        transfers.push({ from: debtor.id, to: first.id, amount: first.amount });
        transfers.push({ from: debtor.id, to: second.id, amount: second.amount });
        settled.add(debtor).add(first).add(second);
    }

    const rest = settleLargestFirst(
        openDebtors.filter((party) => !settled.has(party)).map((party) => ({ ...party })),
        openCreditors.filter((party) => !settled.has(party)).map((party) => ({ ...party }))
    );
    return transfers.concat(rest);
}

/** Triples where two people on one side add up exactly to one person on the other. */
function findTriples(singles: readonly Party[], others: readonly Party[], work: { left: number }) {
    const byAmount = new Map<number, Party[]>();
    for (const party of others) {
        const list = byAmount.get(party.amount);
        if (list) list.push(party);
        else byAmount.set(party.amount, [party]);
    }
    const amounts = [...byAmount.keys()].sort((a, b) => a - b);

    const triples: [Party, Party, Party][] = [];
    for (const single of singles) {
        // Each unordered pair once: the smaller share is at most half the total.
        for (let i = 0; i < amounts.length && amounts[i] * 2 <= single.amount; i++) {
            if (--work.left < 0) return triples;

            const smaller = byAmount.get(amounts[i])!;
            const larger = byAmount.get(single.amount - amounts[i]);
            if (smaller.length === 0 || !larger || larger.length < (larger === smaller ? 2 : 1)) continue;

            triples.push([single, smaller.pop()!, larger.pop()!]);
            break;
        }
    }
    return triples;
}
