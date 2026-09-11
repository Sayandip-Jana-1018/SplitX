'use client';

import { cn } from '@/lib/utils';
import styles from './skeleton.module.css';

interface SkeletonProps {
    variant?: 'text' | 'circle' | 'card' | 'stat' | 'rectangular';
    width?: string | number;
    height?: string | number;
    radius?: string | number;
    className?: string;
    lines?: number;
}

export default function Skeleton({
    variant = 'text',
    width,
    height,
    radius,
    className,
    lines = 1,
}: SkeletonProps) {
    if (variant === 'stat') {
        return (
            <div className={cn(styles.panel, styles.stat, className)}>
                <div className={cn(styles.shimmer, styles.statIcon)} />
                <div className={cn(styles.shimmer, styles.statLabel)} />
                <div className={cn(styles.shimmer, styles.statValue)} />
            </div>
        );
    }

    if (variant === 'card') {
        return (
            <div className={cn(styles.panel, styles.row, className)}>
                <div className={cn(styles.shimmer, styles.rowIcon)} />
                <div style={{ flex: 1 }}>
                    <div className={cn(styles.shimmer, styles.rowTitle)} />
                    <div className={cn(styles.shimmer, styles.rowSubtitle)} />
                </div>
                <div className={cn(styles.shimmer, styles.rowAmount)} />
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
                    borderRadius: radius ?? 'var(--radius-lg)',
                }}
            />
        );
    }

    return (
        <div className={cn(styles.textGroup, className)}>
            {Array.from({ length: lines }).map((_, index) => (
                <div
                    key={index}
                    className={styles.shimmer}
                    style={{
                        width: index === lines - 1 && lines > 1 ? '70%' : width || '100%',
                        height: height || 12,
                        borderRadius: radius ?? 6,
                    }}
                />
            ))}
        </div>
    );
}

/** A grouped list of placeholder rows, mirroring ListGroup + ListRow. */
export function ListSkeleton({ rows = 4 }: { rows?: number }) {
    return (
        <div className={cn(styles.panel, styles.list)}>
            {Array.from({ length: rows }).map((_, index) => (
                <div key={index} className={styles.listRow}>
                    <div className={cn(styles.shimmer, styles.rowIcon)} />
                    <div style={{ flex: 1 }}>
                        <div className={cn(styles.shimmer, styles.rowTitle)} style={{ width: `${58 - (index % 3) * 10}%` }} />
                        <div className={cn(styles.shimmer, styles.rowSubtitle)} />
                    </div>
                    <div className={cn(styles.shimmer, styles.rowAmount)} />
                </div>
            ))}
        </div>
    );
}

export function DashboardSkeleton() {
    return (
        <div className={styles.stack}>
            <div className={styles.centerStack}>
                <Skeleton width={110} height={11} />
                <Skeleton width={170} height={24} radius={8} />
            </div>
            <div className={cn(styles.shimmer, styles.hero)} />
            <div className={styles.quick}>
                {Array.from({ length: 4 }).map((_, index) => (
                    <div key={index} className={styles.centerStack}>
                        <div className={cn(styles.shimmer, styles.quickTile)} />
                        <Skeleton width={44} height={10} />
                    </div>
                ))}
            </div>
            <ListSkeleton rows={3} />
            <ListSkeleton rows={3} />
        </div>
    );
}

export function TransactionSkeleton() {
    return (
        <div className={styles.stack}>
            <Skeleton variant="rectangular" height={112} radius="var(--radius-2xl)" />
            <Skeleton variant="rectangular" height={48} radius="var(--radius-full)" />
            <ListSkeleton rows={5} />
        </div>
    );
}

export function SettlementSkeleton() {
    return (
        <div className={styles.stack}>
            <div className={cn(styles.shimmer, styles.hero)} style={{ height: 168 }} />
            <Skeleton variant="rectangular" height={44} radius="var(--radius-full)" />
            <ListSkeleton rows={3} />
        </div>
    );
}

export function GroupCardSkeleton() {
    return (
        <div className={styles.stack}>
            <div className={styles.twoUp}>
                <Skeleton variant="rectangular" height={48} radius="var(--radius-full)" />
                <Skeleton variant="rectangular" height={48} radius="var(--radius-full)" />
            </div>
            {Array.from({ length: 3 }).map((_, index) => (
                <div key={index} className={cn(styles.panel, styles.groupCard)}>
                    <div className={styles.row} style={{ padding: 0, border: 0, boxShadow: 'none', background: 'transparent' }}>
                        <div className={cn(styles.shimmer, styles.groupEmoji)} />
                        <div style={{ flex: 1 }}>
                            <div className={cn(styles.shimmer, styles.rowTitle)} />
                            <div className={cn(styles.shimmer, styles.rowSubtitle)} />
                        </div>
                    </div>
                    <div className={cn(styles.shimmer)} style={{ height: 30, borderRadius: 12 }} />
                </div>
            ))}
        </div>
    );
}
