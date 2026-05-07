export const SETTLEMENT_PENDING_STATUSES = ['pending', 'initiated', 'paid_pending'] as const;
export const SETTLEMENT_COMPLETED_STATUSES = ['completed', 'confirmed'] as const;
export const SETTLEMENT_TERMINAL_STATUSES = [...SETTLEMENT_COMPLETED_STATUSES, 'cancelled'] as const;

export type SettlementPendingStatus = (typeof SETTLEMENT_PENDING_STATUSES)[number];
export type SettlementCompletedStatus = (typeof SETTLEMENT_COMPLETED_STATUSES)[number];

export function isPendingSettlementStatus(status: string) {
    return SETTLEMENT_PENDING_STATUSES.includes(
        status as SettlementPendingStatus
    );
}

export function isCompletedSettlementStatus(status: string) {
    return SETTLEMENT_COMPLETED_STATUSES.includes(
        status as SettlementCompletedStatus
    );
}

export function isAwaitingReceiverApproval(status: string) {
    return status === 'paid_pending';
}

export function canInitiateSettlementPayment(status: string) {
    return status === 'pending' || status === 'initiated';
}
