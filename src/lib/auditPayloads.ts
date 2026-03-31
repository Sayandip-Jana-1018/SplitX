import {
    FinanceSettlementSnapshot,
    FinanceTransactionSnapshot,
} from '@/lib/groupFinance';

export function serializeTransactionAuditSnapshot(input: {
    id: string;
    tripId: string;
    tripTitle?: string | null;
    title: string;
    amount: number;
    splitType: string;
    payerId: string;
    payerName?: string | null;
    createdAt: Date;
    updatedAt: Date;
    deletedAt?: Date | null;
    splits: { userId: string; amount: number; user?: { name?: string | null } | null }[];
}): FinanceTransactionSnapshot {
    return {
        id: input.id,
        tripId: input.tripId,
        tripTitle: input.tripTitle || 'Trip',
        title: input.title,
        amount: input.amount,
        splitType: input.splitType,
        payerId: input.payerId,
        payerName: input.payerName || 'Unknown',
        createdAt: input.createdAt,
        updatedAt: input.updatedAt,
        deletedAt: input.deletedAt || null,
        splits: input.splits.map((split) => ({
            userId: split.userId,
            userName: split.user?.name || 'Unknown',
            amount: split.amount,
        })),
    };
}

export function serializeSettlementAuditSnapshot(input: {
    id: string;
    tripId: string;
    tripTitle?: string | null;
    fromId: string;
    fromName?: string | null;
    toId: string;
    toName?: string | null;
    amount: number;
    status: string;
    method?: string | null;
    note?: string | null;
    createdAt: Date;
    updatedAt: Date;
    deletedAt?: Date | null;
}): FinanceSettlementSnapshot {
    return {
        id: input.id,
        tripId: input.tripId,
        tripTitle: input.tripTitle || 'Trip',
        fromId: input.fromId,
        fromName: input.fromName || 'Unknown',
        toId: input.toId,
        toName: input.toName || 'Unknown',
        amount: input.amount,
        status: input.status,
        method: input.method || null,
        note: input.note || null,
        createdAt: input.createdAt,
        updatedAt: input.updatedAt,
        deletedAt: input.deletedAt || null,
    };
}
