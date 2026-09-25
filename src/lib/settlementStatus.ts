const SETTLEMENT_PENDING_STATUSES = ['pending', 'initiated', 'paid_pending'] as const;
const SETTLEMENT_COMPLETED_STATUSES = ['completed', 'confirmed'] as const;

type SettlementPendingStatus = (typeof SETTLEMENT_PENDING_STATUSES)[number];
type SettlementCompletedStatus = (typeof SETTLEMENT_COMPLETED_STATUSES)[number];

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
