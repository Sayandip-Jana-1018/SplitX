'use client';

import { cn } from '@/lib/utils';
import styles from './skeleton.module.css';

interface SkeletonProps {
    variant?: 'text' | 'circle' | 'card' | 'stat' | 'rectangular';
    width?: string | number;
    height?: string | number;
    className?: string;
    lines?: number;
}

export default function Skeleton({
    variant = 'text',
    width,
    height,
    className,
    lines = 1,
}: SkeletonProps) {
    if (variant === 'stat') {
        return (
            <div className={cn(styles.skeleton, styles.stat, className)}>
                <div className={cn(styles.shimmer, styles.statIcon)} />
                <div style={{ flex: 1 }}>
                    <div className={cn(styles.shimmer, styles.statLabel)} />
                    <div className={cn(styles.shimmer, styles.statValue)} />
                </div>
            </div>
        );
    }

    if (variant === 'card') {
        return (
            <div className={cn(styles.skeleton, styles.card, className)}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div className={cn(styles.shimmer, styles.cardIcon)} />
                    <div style={{ flex: 1 }}>
                        <div className={cn(styles.shimmer, styles.cardTitle)} />
                        <div className={cn(styles.shimmer, styles.cardSubtitle)} />
                    </div>
                    <div className={cn(styles.shimmer, styles.cardAmount)} />
                </div>
            </div>
        );
    }

    if (variant === 'circle') {
        return (
            <div
                className={cn(styles.shimmer, styles.circle, className)}
                style={{ width: width || 40, height: height || 40 }}
            />
        );
    }

    if (variant === 'rectangular') {
        return (
            <div
                className={cn(styles.shimmer, className)}
                style={{
                    width: width || '100%',
                    height: height || 20,
                    borderRadius: 'var(--radius-md)',
                }}
            />
        );
    }

    // text variant with lines
    return (
        <div className={cn(styles.textGroup, className)}>
            {Array.from({ length: lines }).map((_, i) => (
                <div
                    key={i}
                    className={styles.shimmer}
                    style={{
                        width: i === lines - 1 && lines > 1 ? '70%' : width || '100%',
                        height: height || 14,
                        borderRadius: 'var(--radius-sm)',
                    }}
                />
            ))}
        </div>
    );
}

/** Pre-built skeleton layouts for common patterns */
export function DashboardSkeleton() {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
            {/* Welcome */}
            <div>
                <Skeleton width={120} height={12} />
                <div style={{ marginTop: 8 }}>
                    <Skeleton width={220} height={28} />
                </div>
                <div style={{ marginTop: 8 }}>
                    <Skeleton width={300} height={14} />
                </div>
            </div>

            {/* Stats grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 'var(--space-3)' }}>
                <Skeleton variant="stat" />
                <Skeleton variant="stat" />
                <Skeleton variant="stat" />
                <Skeleton variant="stat" />
            </div>

            {/* Transaction list */}
            <div>
                <Skeleton width={160} height={16} />
                <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                    <Skeleton variant="card" />
                    <Skeleton variant="card" />
                    <Skeleton variant="card" />
                </div>
            </div>
        </div>
    );
}

/** Skeleton for transaction list page */
export function TransactionSkeleton() {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            {/* Search bar */}
            <Skeleton variant="rectangular" height={44} />
            {/* Filter chips */}
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                <Skeleton variant="rectangular" width={80} height={32} />
                <Skeleton variant="rectangular" width={100} height={32} />
                <Skeleton variant="rectangular" width={70} height={32} />
            </div>
            {/* Transaction cards */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} variant="card" />
                ))}
            </div>
        </div>
    );
}

/** Skeleton for settlements page */
export function SettlementSkeleton() {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            {/* Summary row */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 'var(--space-3)' }}>
                <Skeleton variant="stat" />
                <Skeleton variant="stat" />
            </div>
            {/* Section header */}
            <Skeleton width={140} height={16} />
            {/* Settlement cards */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} variant="card" />
                ))}
            </div>
        </div>
    );
}

/** Skeleton for groups grid */
export function GroupCardSkeleton() {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Skeleton width={160} height={24} />
                <Skeleton variant="rectangular" width={120} height={36} />
            </div>
            {/* Group cards */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} style={{
                        padding: 'var(--space-4)',
                        borderRadius: 'var(--radius-xl)',
                        background: 'var(--surface-card)',
                        border: '1px solid var(--border-default)',
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                            <Skeleton variant="circle" width={44} height={44} />
                            <div style={{ flex: 1 }}>
                                <Skeleton width={140} height={16} />
                                <div style={{ marginTop: 6 }}>
                                    <Skeleton width={200} height={12} />
                                </div>
                            </div>
                        </div>
                        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                            <Skeleton variant="rectangular" width={80} height={24} />
                            <Skeleton variant="rectangular" width={100} height={24} />
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

