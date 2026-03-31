export const BALANCE_SETTLEMENT_STATUSES = ['completed', 'confirmed'] as const;

export interface FinanceMember {
    id: string;
    name: string;
    image: string | null;
    upiId?: string | null;
    role?: string;
}

export interface FinanceSplitSnapshot {
    userId: string;
    userName: string;
    amount: number;
}

export interface FinanceTransactionSnapshot {
    id: string;
    tripId: string;
    tripTitle: string;
    title: string;
    amount: number;
    splitType: string;
    payerId: string;
    payerName: string;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
    splits: FinanceSplitSnapshot[];
}

export interface FinanceSettlementSnapshot {
    id: string;
    tripId: string;
    tripTitle: string;
    fromId: string;
    fromName: string;
    toId: string;
    toName: string;
    amount: number;
    status: string;
    method: string | null;
    note: string | null;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
}

export interface SimplifiedTransfer {
    from: string;
    to: string;
    amount: number;
    fromName: string;
    toName: string;
    fromImage: string | null;
    toImage: string | null;
    toUpiId: string | null;
}

export interface BalanceHistoryEntry {
    id: string;
    eventType: 'expense' | 'settlement' | 'edit';
    sourceId: string;
    sourceLabel: string;
    createdAt: string;
    beforeBalance: number;
    delta: number;
    afterBalance: number;
    counterparties: string[];
    explanation: string;
    filterKey: 'all' | 'expenses' | 'settlements' | 'edits';
    beforeRouteSummary: string;
    afterRouteSummary: string;
}

type BalanceDeltaMap = Record<string, number>;

type TimelineEvent = {
    id: string;
    sourceId: string;
    sourceLabel: string;
    eventType: 'expense' | 'settlement' | 'edit';
    filterKey: 'all' | 'expenses' | 'settlements' | 'edits';
    occurredAt: Date;
    deltaByUser: BalanceDeltaMap;
    counterparties: string[];
    explanation: string;
};

type TransactionAuditDetails = {
    groupId?: string;
    tripId?: string;
    before?: FinanceTransactionSnapshot | null;
    after?: FinanceTransactionSnapshot | null;
};

export function isCompletedSettlementStatus(status: string) {
    return BALANCE_SETTLEMENT_STATUSES.includes(
        status as (typeof BALANCE_SETTLEMENT_STATUSES)[number]
    );
}

export function cloneBalances(balances: Record<string, number>) {
    return Object.fromEntries(Object.entries(balances).map(([userId, amount]) => [userId, amount]));
}

export function createZeroBalances(memberIds: string[]) {
    return Object.fromEntries(memberIds.map((memberId) => [memberId, 0])) as Record<string, number>;
}

export function applyDeltaMap(
    balances: Record<string, number>,
    deltaByUser: BalanceDeltaMap
) {
    for (const [userId, delta] of Object.entries(deltaByUser)) {
        balances[userId] = Math.round((balances[userId] || 0) + delta);
    }
}

export function buildTransactionDeltaMap(snapshot: FinanceTransactionSnapshot | null | undefined) {
    if (!snapshot) return {};

    const deltaByUser: BalanceDeltaMap = {};
    deltaByUser[snapshot.payerId] = (deltaByUser[snapshot.payerId] || 0) + snapshot.amount;

    for (const split of snapshot.splits) {
        deltaByUser[split.userId] = (deltaByUser[split.userId] || 0) - split.amount;
    }

    return deltaByUser;
}

export function buildSettlementDeltaMap(snapshot: FinanceSettlementSnapshot | null | undefined) {
    if (!snapshot || !isCompletedSettlementStatus(snapshot.status) || snapshot.deletedAt) {
        return {};
    }

    return {
        [snapshot.fromId]: snapshot.amount,
        [snapshot.toId]: -snapshot.amount,
    };
}

export function diffDeltaMaps(before: BalanceDeltaMap, after: BalanceDeltaMap) {
    const userIds = new Set([...Object.keys(before), ...Object.keys(after)]);
    const diff: BalanceDeltaMap = {};

    for (const userId of userIds) {
        const delta = (after[userId] || 0) - (before[userId] || 0);
        if (Math.abs(delta) > 0) {
            diff[userId] = delta;
        }
    }

    return diff;
}

export function computeGroupBalances(params: {
    memberIds: string[];
    transactions: FinanceTransactionSnapshot[];
    settlements: FinanceSettlementSnapshot[];
}) {
    const balances = createZeroBalances(params.memberIds);

    for (const transaction of params.transactions) {
        if (transaction.deletedAt) continue;
        applyDeltaMap(balances, buildTransactionDeltaMap(transaction));
    }

    for (const settlement of params.settlements) {
        applyDeltaMap(balances, buildSettlementDeltaMap(settlement));
    }

    return balances;
}

export function simplifyGroupBalances(params: {
    balances: Record<string, number>;
    members: FinanceMember[];
}) {
    const debtors: { id: string; amount: number }[] = [];
    const creditors: { id: string; amount: number }[] = [];
    const memberMap = new Map(params.members.map((member) => [member.id, member]));

    for (const member of params.members) {
        const balance = params.balances[member.id] || 0;
        if (balance < -1) {
            debtors.push({ id: member.id, amount: -balance });
        } else if (balance > 1) {
            creditors.push({ id: member.id, amount: balance });
        }
    }

    debtors.sort((a, b) => b.amount - a.amount);
    creditors.sort((a, b) => b.amount - a.amount);

    const transfers: SimplifiedTransfer[] = [];
    let debtorIndex = 0;
    let creditorIndex = 0;

    while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
        const transfer = Math.min(
            debtors[debtorIndex].amount,
            creditors[creditorIndex].amount
        );

        if (transfer > 0) {
            const fromMember = memberMap.get(debtors[debtorIndex].id);
            const toMember = memberMap.get(creditors[creditorIndex].id);

            transfers.push({
                from: debtors[debtorIndex].id,
                to: creditors[creditorIndex].id,
                amount: Math.round(transfer),
                fromName: fromMember?.name || 'Unknown',
                toName: toMember?.name || 'Unknown',
                fromImage: fromMember?.image || null,
                toImage: toMember?.image || null,
                toUpiId: toMember?.upiId || null,
            });
        }

        debtors[debtorIndex].amount -= transfer;
        creditors[creditorIndex].amount -= transfer;

        if (debtors[debtorIndex].amount < 1) debtorIndex += 1;
        if (creditors[creditorIndex].amount < 1) creditorIndex += 1;
    }

    return transfers;
}

export function summarizeUserRoute(
    transfers: SimplifiedTransfer[],
    userId: string
) {
    const outgoing = transfers
        .filter((transfer) => transfer.from === userId)
        .map((transfer) => `Pay ${transfer.toName} ${formatCompactAmount(transfer.amount)}`);
    const incoming = transfers
        .filter((transfer) => transfer.to === userId)
        .map((transfer) => `Receive ${formatCompactAmount(transfer.amount)} from ${transfer.fromName}`);

    if (outgoing.length === 0 && incoming.length === 0) {
        return 'All settled up';
    }

    const parts = [...outgoing, ...incoming];
    return parts.slice(0, 2).join(' • ');
}

export function buildBalanceHistory(params: {
    userId: string;
    members: FinanceMember[];
    transactions: FinanceTransactionSnapshot[];
    settlements: FinanceSettlementSnapshot[];
    auditLogs: {
        id: string;
        action: string;
        entityId: string;
        details: unknown;
        createdAt: Date;
    }[];
    limit: number;
}) {
    const currentBalances = computeGroupBalances({
        memberIds: params.members.map((member) => member.id),
        transactions: params.transactions.filter((transaction) => !transaction.deletedAt),
        settlements: params.settlements.filter((settlement) => !settlement.deletedAt),
    });

    const timeline = buildTimelineEvents(params);
    const runningBalances = createZeroBalances(params.members.map((member) => member.id));
    const entries: BalanceHistoryEntry[] = [];
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    let changeCountThisWeek = 0;

    for (const event of timeline) {
        if (Math.abs(event.deltaByUser[params.userId] || 0) < 1) {
            applyDeltaMap(runningBalances, event.deltaByUser);
            continue;
        }

        const beforeBalance = runningBalances[params.userId] || 0;
        const beforeRouteSummary = summarizeUserRoute(
            simplifyGroupBalances({ balances: cloneBalances(runningBalances), members: params.members }),
            params.userId
        );

        applyDeltaMap(runningBalances, event.deltaByUser);

        const afterBalance = runningBalances[params.userId] || 0;
        const afterRouteSummary = summarizeUserRoute(
            simplifyGroupBalances({ balances: cloneBalances(runningBalances), members: params.members }),
            params.userId
        );

        if (event.occurredAt.getTime() >= weekAgo) {
            changeCountThisWeek += 1;
        }

        entries.push({
            id: event.id,
            eventType: event.eventType,
            sourceId: event.sourceId,
            sourceLabel: event.sourceLabel,
            createdAt: event.occurredAt.toISOString(),
            beforeBalance,
            delta: event.deltaByUser[params.userId] || 0,
            afterBalance,
            counterparties: event.counterparties,
            explanation: `${event.explanation} ${describeRouteChange(beforeRouteSummary, afterRouteSummary)}`.trim(),
            filterKey: event.filterKey,
            beforeRouteSummary,
            afterRouteSummary,
        });
    }

    const limitedEntries = entries
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, params.limit);

    return {
        currentBalance: currentBalances[params.userId] || 0,
        changeCountThisWeek,
        currentRouteSummary: summarizeUserRoute(
            simplifyGroupBalances({ balances: cloneBalances(currentBalances), members: params.members }),
            params.userId
        ),
        entries: limitedEntries,
    };
}

function buildTimelineEvents(params: {
    userId: string;
    members: FinanceMember[];
    transactions: FinanceTransactionSnapshot[];
    settlements: FinanceSettlementSnapshot[];
    auditLogs: {
        id: string;
        action: string;
        entityId: string;
        details: unknown;
        createdAt: Date;
    }[];
}) {
    const memberNames = new Map(params.members.map((member) => [member.id, member.name]));
    const logsByEntity = new Map<string, {
        id: string;
        action: string;
        entityId: string;
        details: TransactionAuditDetails | null;
        createdAt: Date;
    }[]>();

    for (const log of params.auditLogs) {
        const details = parseTransactionAuditDetails(log.details);
        const logs = logsByEntity.get(log.entityId) || [];
        logs.push({ ...log, details });
        logsByEntity.set(log.entityId, logs);
    }

    const events: TimelineEvent[] = [];

    for (const transaction of params.transactions) {
        const entityLogs = (logsByEntity.get(transaction.id) || []).sort(
            (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
        );

        if (entityLogs.length === 0) {
            if (!transaction.deletedAt) {
                events.push(createTransactionCreateEvent(transaction));
            }
            continue;
        }

        const firstSnapshot =
            entityLogs[0]?.details?.before ||
            entityLogs[0]?.details?.after ||
            transaction;

        if (firstSnapshot) {
            events.push(createTransactionCreateEvent({
                ...firstSnapshot,
                createdAt: transaction.createdAt,
            }));
        }

        for (const log of entityLogs) {
            if (log.action === 'create') {
                continue;
            }

            const beforeSnapshot = log.details?.before || null;
            const afterSnapshot = log.details?.after || null;
            const deltaByUser = diffDeltaMaps(
                buildTransactionDeltaMap(beforeSnapshot),
                buildTransactionDeltaMap(afterSnapshot)
            );

            if (Object.keys(deltaByUser).length === 0) {
                continue;
            }

            const counterparties = collectTransactionCounterparties(
                beforeSnapshot || afterSnapshot,
                memberNames
            );

            events.push({
                id: `transaction-log-${log.id}`,
                sourceId: log.entityId,
                sourceLabel: afterSnapshot?.title || beforeSnapshot?.title || 'Expense',
                eventType: 'edit',
                filterKey: 'edits',
                occurredAt: log.createdAt,
                deltaByUser,
                counterparties,
                explanation: describeTransactionAuditEvent(log.action, beforeSnapshot, afterSnapshot, params.userId, memberNames),
            });
        }
    }

    for (const settlement of params.settlements) {
        if (!isCompletedSettlementStatus(settlement.status) || settlement.deletedAt) {
            continue;
        }

        events.push({
            id: `settlement-${settlement.id}`,
            sourceId: settlement.id,
            sourceLabel: `${settlement.fromName} paid ${settlement.toName}`,
            eventType: 'settlement',
            filterKey: 'settlements',
            occurredAt: settlement.updatedAt,
            deltaByUser: buildSettlementDeltaMap(settlement),
            counterparties: [settlement.fromName, settlement.toName].filter((name) => name !== 'Unknown'),
            explanation: describeSettlementEvent(settlement, params.userId),
        });
    }

    return events.sort((a, b) => {
        const timeDiff = a.occurredAt.getTime() - b.occurredAt.getTime();
        if (timeDiff !== 0) return timeDiff;
        return a.id.localeCompare(b.id);
    });
}

function createTransactionCreateEvent(snapshot: FinanceTransactionSnapshot) {
    return {
        id: `transaction-${snapshot.id}-create`,
        sourceId: snapshot.id,
        sourceLabel: snapshot.title,
        eventType: 'expense' as const,
        filterKey: 'expenses' as const,
        occurredAt: snapshot.createdAt,
        deltaByUser: buildTransactionDeltaMap(snapshot),
        counterparties: collectTransactionCounterparties(snapshot),
        explanation: describeTransactionCreateEvent(snapshot),
    };
}

function collectTransactionCounterparties(
    snapshot: FinanceTransactionSnapshot | null | undefined,
    memberNames?: Map<string, string>
) {
    if (!snapshot) return [];

    const names = new Set<string>();
    for (const split of snapshot.splits) {
        const name = split.userName || memberNames?.get(split.userId) || 'Unknown';
        if (name !== snapshot.payerName) {
            names.add(name);
        }
    }
    if (snapshot.payerName) {
        names.add(snapshot.payerName);
    }
    return Array.from(names);
}

function describeTransactionCreateEvent(snapshot: FinanceTransactionSnapshot) {
    if (snapshot.splitType === 'custom') {
        return `${snapshot.payerName} added a custom split for ${snapshot.title}.`;
    }
    return `${snapshot.payerName} added ${snapshot.title}.`;
}

function describeTransactionAuditEvent(
    action: string,
    beforeSnapshot: FinanceTransactionSnapshot | null,
    afterSnapshot: FinanceTransactionSnapshot | null,
    userId: string,
    memberNames: Map<string, string>
) {
    if (action === 'delete' || !afterSnapshot) {
        return `The expense "${beforeSnapshot?.title || 'Expense'}" was deleted.`;
    }

    const beforeAmount = transactionUserImpact(beforeSnapshot, userId);
    const afterAmount = transactionUserImpact(afterSnapshot, userId);

    if ((beforeSnapshot?.amount || 0) !== (afterSnapshot?.amount || 0)) {
        return `"${afterSnapshot.title}" changed from ${formatCompactAmount(beforeSnapshot?.amount || 0)} to ${formatCompactAmount(afterSnapshot.amount)}. Your share moved from ${formatCompactAmount(Math.abs(beforeAmount))} to ${formatCompactAmount(Math.abs(afterAmount))}.`;
    }

    const beforeParticipants = participantNames(beforeSnapshot, memberNames);
    const afterParticipants = participantNames(afterSnapshot, memberNames);
    if (beforeParticipants !== afterParticipants) {
        return `"${afterSnapshot.title}" changed who was included in the split.`;
    }

    return `"${afterSnapshot.title}" was updated.`;
}

function describeSettlementEvent(
    settlement: FinanceSettlementSnapshot,
    userId: string
) {
    if (settlement.fromId === userId) {
        return `You paid ${formatCompactAmount(settlement.amount)} to ${settlement.toName} via ${settlement.method || 'settlement'}.`;
    }
    if (settlement.toId === userId) {
        return `${settlement.fromName} paid you ${formatCompactAmount(settlement.amount)} via ${settlement.method || 'settlement'}.`;
    }
    return `${settlement.fromName} settled ${formatCompactAmount(settlement.amount)} with ${settlement.toName}.`;
}

function describeRouteChange(beforeRouteSummary: string, afterRouteSummary: string) {
    if (beforeRouteSummary === afterRouteSummary) {
        return '';
    }

    return `Route changed from "${beforeRouteSummary}" to "${afterRouteSummary}".`;
}

function transactionUserImpact(snapshot: FinanceTransactionSnapshot | null | undefined, userId: string) {
    if (!snapshot) return 0;
    const deltaByUser = buildTransactionDeltaMap(snapshot);
    return deltaByUser[userId] || 0;
}

function participantNames(
    snapshot: FinanceTransactionSnapshot | null | undefined,
    memberNames: Map<string, string>
) {
    if (!snapshot) return '';
    return snapshot.splits
        .map((split) => split.userName || memberNames.get(split.userId) || split.userId)
        .sort()
        .join('|');
}

function formatCompactAmount(amount: number) {
    const normalized = (amount / 100).toLocaleString('en-IN', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
    });
    return `₹${normalized}`;
}

function parseTransactionAuditDetails(details: unknown): TransactionAuditDetails | null {
    if (!details || typeof details !== 'object' || Array.isArray(details)) {
        return null;
    }

    const record = details as Record<string, unknown>;
    return {
        groupId: typeof record.groupId === 'string' ? record.groupId : undefined,
        tripId: typeof record.tripId === 'string' ? record.tripId : undefined,
        before: normalizeTransactionSnapshot(record.before),
        after: normalizeTransactionSnapshot(record.after),
    };
}

function normalizeTransactionSnapshot(value: unknown): FinanceTransactionSnapshot | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }

    const record = value as Record<string, unknown>;
    const splits = Array.isArray(record.splits) ? record.splits : [];

    return {
        id: typeof record.id === 'string' ? record.id : '',
        tripId: typeof record.tripId === 'string' ? record.tripId : '',
        tripTitle: typeof record.tripTitle === 'string' ? record.tripTitle : 'Trip',
        title: typeof record.title === 'string' ? record.title : 'Expense',
        amount: typeof record.amount === 'number' ? record.amount : 0,
        splitType: typeof record.splitType === 'string' ? record.splitType : 'equal',
        payerId: typeof record.payerId === 'string' ? record.payerId : '',
        payerName: typeof record.payerName === 'string' ? record.payerName : 'Unknown',
        createdAt: toDate(record.createdAt),
        updatedAt: toDate(record.updatedAt),
        deletedAt: record.deletedAt ? toDate(record.deletedAt) : null,
        splits: splits
            .map((split) => {
                if (!split || typeof split !== 'object' || Array.isArray(split)) {
                    return null;
                }
                const splitRecord = split as Record<string, unknown>;
                return {
                    userId: typeof splitRecord.userId === 'string' ? splitRecord.userId : '',
                    userName: typeof splitRecord.userName === 'string' ? splitRecord.userName : 'Unknown',
                    amount: typeof splitRecord.amount === 'number' ? splitRecord.amount : 0,
                };
            })
            .filter((split): split is FinanceSplitSnapshot => Boolean(split?.userId)),
    };
}

function toDate(value: unknown) {
    if (value instanceof Date) return value;
    if (typeof value === 'string' || typeof value === 'number') return new Date(value);
    return new Date();
}
