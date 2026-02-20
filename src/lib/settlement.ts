/**
 * SplitX — Settlement Algorithm
 * Greedy Min-Transfer Netting + Graph-Optimized Settlement
 *
 * Calculates who owes whom using minimal number of transfers.
 * All amounts in paise (integer) to avoid floating point issues.
 *
 * Phase 2: Added optimizeSettlements() that uses net-balance
 * consolidation with exact-match pruning for even fewer transfers.
 */

export interface Balance {
    userId: string;
    name: string;
    paid: number;     // total paid by this user (paise)
    owes: number;     // total owed by this user (paise)
    balance: number;  // paid - owes (positive = creditor, negative = debtor)
}

export interface Transfer {
    fromId: string;
    fromName: string;
    toId: string;
    toName: string;
    amount: number; // paise
}

export interface SettlementResult {
    balances: Balance[];
    transfers: Transfer[];
    totalSpent: number; // paise
    perPersonAvg: number; // paise
    optimizationSavings?: number; // how many fewer transfers vs naive
}

interface TransactionData {
    payerId: string;
    payerName: string;
    splits: { userId: string; userName: string; amount: number }[];
}

/**
 * Calculate balances and optimal transfers for a set of transactions.
 * Uses graph-optimized settlement for minimum transfers.
 */
export function calculateSettlement(
    transactions: TransactionData[]
): SettlementResult {
    // Step 1: Accumulate paid and owed amounts per user
    const userMap = new Map<string, { name: string; paid: number; owes: number }>();

    for (const txn of transactions) {
        // Payer
        const payer = userMap.get(txn.payerId) || { name: txn.payerName, paid: 0, owes: 0 };
        const totalTxn = txn.splits.reduce((sum, s) => sum + s.amount, 0);
        payer.paid += totalTxn;
        userMap.set(txn.payerId, payer);

        // Each person who owes
        for (const split of txn.splits) {
            const person = userMap.get(split.userId) || { name: split.userName, paid: 0, owes: 0 };
            person.owes += split.amount;
            if (!userMap.has(split.userId)) {
                userMap.set(split.userId, person);
            }
        }
    }

    // Step 2: Calculate balances
    const balances: Balance[] = [];
    let totalSpent = 0;

    for (const [userId, data] of userMap) {
        const balance = data.paid - data.owes;
        balances.push({
            userId,
            name: data.name,
            paid: data.paid,
            owes: data.owes,
            balance,
        });
        totalSpent += data.paid;
    }

    const perPersonAvg = balances.length > 0 ? Math.round(totalSpent / balances.length) : 0;

    // Step 3: Optimized settlement (Phase 2 upgrade)
    const naiveTransfers = minimizeTransfers(balances);
    const optimizedTransfers = optimizeSettlements(balances);

    // Use whichever produces fewer transfers
    const transfers = optimizedTransfers.length <= naiveTransfers.length
        ? optimizedTransfers
        : naiveTransfers;

    const optimizationSavings = naiveTransfers.length - transfers.length;

    return {
        balances: balances.sort((a, b) => b.balance - a.balance),
        transfers,
        totalSpent,
        perPersonAvg,
        optimizationSavings: optimizationSavings > 0 ? optimizationSavings : undefined,
    };
}

/**
 * Original greedy algorithm (preserved for comparison).
 */
function minimizeTransfers(balances: Balance[]): Transfer[] {
    const creditors: { userId: string; name: string; amount: number }[] = [];
    const debtors: { userId: string; name: string; amount: number }[] = [];

    for (const b of balances) {
        if (b.balance > 0) {
            creditors.push({ userId: b.userId, name: b.name, amount: b.balance });
        } else if (b.balance < 0) {
            debtors.push({ userId: b.userId, name: b.name, amount: -b.balance });
        }
    }

    creditors.sort((a, b) => b.amount - a.amount);
    debtors.sort((a, b) => b.amount - a.amount);

    const transfers: Transfer[] = [];
    let ci = 0;
    let di = 0;

    while (ci < creditors.length && di < debtors.length) {
        const creditor = creditors[ci];
        const debtor = debtors[di];
        const transferAmount = Math.min(creditor.amount, debtor.amount);

        if (transferAmount > 0) {
            transfers.push({
                fromId: debtor.userId,
                fromName: debtor.name,
                toId: creditor.userId,
                toName: creditor.name,
                amount: transferAmount,
            });
        }

        creditor.amount -= transferAmount;
        debtor.amount -= transferAmount;

        if (creditor.amount === 0) ci++;
        if (debtor.amount === 0) di++;
    }

    return transfers;
}

/**
 * Phase 2: Graph-optimized settlement algorithm.
 *
 * Strategy:
 * 1. First pass: find exact matches (debtor amount == creditor amount)
 *    → these cancel in a single transfer with no remainder
 * 2. Second pass: sorted merge of remaining debtors and creditors
 *
 * This produces fewer transfers than the naive greedy approach,
 * especially in groups where many people owe similar amounts.
 */
export function optimizeSettlements(balances: Balance[]): Transfer[] {
    const creditors: { userId: string; name: string; amount: number }[] = [];
    const debtors: { userId: string; name: string; amount: number }[] = [];

    for (const b of balances) {
        if (b.balance > 0) {
            creditors.push({ userId: b.userId, name: b.name, amount: b.balance });
        } else if (b.balance < 0) {
            debtors.push({ userId: b.userId, name: b.name, amount: -b.balance });
        }
    }

    const transfers: Transfer[] = [];
    const usedCreditors = new Set<number>();
    const usedDebtors = new Set<number>();

    // Pass 1: Find exact matches (eliminates 2 people per transfer)
    for (let di = 0; di < debtors.length; di++) {
        if (usedDebtors.has(di)) continue;
        for (let ci = 0; ci < creditors.length; ci++) {
            if (usedCreditors.has(ci)) continue;
            if (debtors[di].amount === creditors[ci].amount) {
                transfers.push({
                    fromId: debtors[di].userId,
                    fromName: debtors[di].name,
                    toId: creditors[ci].userId,
                    toName: creditors[ci].name,
                    amount: debtors[di].amount,
                });
                usedDebtors.add(di);
                usedCreditors.add(ci);
                break;
            }
        }
    }

    // Pass 2: Sorted merge of remaining
    const remCreditors = creditors
        .filter((_, i) => !usedCreditors.has(i))
        .sort((a, b) => b.amount - a.amount);
    const remDebtors = debtors
        .filter((_, i) => !usedDebtors.has(i))
        .sort((a, b) => b.amount - a.amount);

    let ci = 0;
    let di = 0;

    while (ci < remCreditors.length && di < remDebtors.length) {
        const creditor = remCreditors[ci];
        const debtor = remDebtors[di];
        const transferAmount = Math.min(creditor.amount, debtor.amount);

        if (transferAmount > 0) {
            transfers.push({
                fromId: debtor.userId,
                fromName: debtor.name,
                toId: creditor.userId,
                toName: creditor.name,
                amount: transferAmount,
            });
        }

        creditor.amount -= transferAmount;
        debtor.amount -= transferAmount;

        if (creditor.amount === 0) ci++;
        if (debtor.amount === 0) di++;
    }

    return transfers;
}

/**
 * Calculate an equal split amount per person.
 * Handles remainder by distributing extra paise to first N users.
 */
export function calculateEqualSplit(
    totalPaise: number,
    numPeople: number
): number[] {
    if (numPeople <= 0) return [];

    const base = Math.floor(totalPaise / numPeople);
    const remainder = totalPaise - base * numPeople;

    return Array.from({ length: numPeople }, (_, i) =>
        i < remainder ? base + 1 : base
    );
}
