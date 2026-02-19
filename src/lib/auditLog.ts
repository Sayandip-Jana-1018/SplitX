import { prisma } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { isFeatureEnabled } from '@/lib/featureFlags';

// ═══════════════════════════════════════════════════════════════
// Audit Log Helper — call from API routes on data mutations.
// ═══════════════════════════════════════════════════════════════

type AuditAction = 'create' | 'update' | 'delete';
type EntityType = 'transaction' | 'settlement' | 'group' | 'group_member';

interface AuditLogParams {
    userId: string;
    action: AuditAction;
    entityType: EntityType;
    entityId: string;
    details?: Record<string, unknown>;
}

/**
 * Create an audit log entry for tracking data modifications.
 * Silently no-ops if audit logging is disabled.
 */
export async function createAuditLog(params: AuditLogParams) {
    if (!isFeatureEnabled('auditLogs')) return null;

    try {
        return await prisma.auditLog.create({
            data: {
                userId: params.userId,
                action: params.action,
                entityType: params.entityType,
                entityId: params.entityId,
                details: params.details as Prisma.InputJsonValue | undefined,
            },
        });
    } catch (error) {
        console.error('Failed to create audit log:', error);
        return null;
    }
}
