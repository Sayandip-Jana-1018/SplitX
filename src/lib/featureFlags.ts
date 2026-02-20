// ═══════════════════════════════════════════════════════════════
// SplitX — Feature Flags
// Toggle features on/off without code changes.
// ═══════════════════════════════════════════════════════════════

export const featureFlags = {
    /** In-app notification system (bell icon + dropdown) */
    notifications: true,

    /** AI-powered expense chat assistant (Gemini) */
    aiChat: true,

    /** Advanced analytics v2 (budgets, trends, insights) */
    analyticsV2: true,

    /** Smart debt optimization algorithm */
    smartSettlements: true,

    /** Audit logging for data changes */
    auditLogs: true,

    /** System health admin page */
    systemHealth: true,

    /** Soft delete (mark as deleted instead of hard delete) */
    softDelete: true,
} as const;

export type FeatureFlag = keyof typeof featureFlags;

/** Check if a feature is enabled */
export function isFeatureEnabled(flag: FeatureFlag): boolean {
    return featureFlags[flag] ?? false;
}
