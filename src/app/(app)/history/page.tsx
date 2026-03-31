'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { ArrowRight, GitBranch, History as HistoryIcon, Users } from 'lucide-react';
import Button from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { formatCurrency } from '@/lib/utils';

interface GroupSummary {
    id: string;
    name: string;
    emoji: string;
    totalSpent: number;
    members: { user: { id: string; name: string | null; image: string | null } }[];
}

interface JourneyPreview {
    currentBalance: number;
    currentRouteSummary: string;
    changeCountThisWeek: number;
}

const fetcher = async (url: string) => {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error('Failed to load history');
    }
    return response.json();
};

export default function HistoryPage() {
    const router = useRouter();
    const { data, error, isLoading } = useSWR<GroupSummary[]>('/api/groups', fetcher);
    const groups = useMemo(() => Array.isArray(data) ? data : [], [data]);
    const [previews, setPreviews] = useState<Record<string, JourneyPreview>>({});

    useEffect(() => {
        if (groups.length === 1) {
            router.replace(`/groups/${groups[0].id}/journey`);
        }
    }, [groups, router]);

    useEffect(() => {
        if (groups.length <= 1) return;

        let cancelled = false;

        Promise.all(
            groups.map(async (group) => {
                try {
                    const response = await fetch(`/api/groups/${group.id}/balance-history?limit=1`);
                    if (!response.ok) return null;
                    const history = await response.json();
                    return [
                        group.id,
                        {
                            currentBalance: history.currentBalance || 0,
                            currentRouteSummary: history.currentRouteSummary || 'All settled up',
                            changeCountThisWeek: history.changeCountThisWeek || 0,
                        } satisfies JourneyPreview,
                    ] as const;
                } catch {
                    return null;
                }
            }),
        ).then((results) => {
            if (cancelled) return;
            const next: Record<string, JourneyPreview> = {};
            for (const result of results) {
                if (!result) continue;
                next[result[0]] = result[1];
            }
            setPreviews(next);
        });

        return () => {
            cancelled = true;
        };
    }, [groups]);

    if (isLoading || (groups.length === 1 && !error)) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                {[0, 1, 2].map((index) => (
                    <Card key={index} padding="normal">
                        <div style={{ height: 120, borderRadius: 'var(--radius-2xl)', background: 'rgba(var(--accent-500-rgb), 0.06)' }} />
                    </Card>
                ))}
            </div>
        );
    }

    if (error) {
        return (
            <Card padding="normal">
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-3)', textAlign: 'center' }}>
                    <div className="page-kicker">History</div>
                    <h2 className="page-hero-title" style={{ fontSize: 'clamp(1.85rem, 5vw, 2.6rem)' }}>
                        We couldn&apos;t open your history right now
                    </h2>
                    <p className="page-hero-subtitle">Try again in a moment. Your Balance Journey data stays tied to your own account only.</p>
                    <Button onClick={() => router.refresh()}>Try Again</Button>
                </div>
            </Card>
        );
    }

    if (groups.length === 0) {
        return (
            <Card padding="normal" glow>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 'var(--space-3)' }}>
                    <div className="page-kicker">History</div>
                    <h2 className="page-hero-title" style={{ fontSize: 'clamp(1.9rem, 5vw, 2.7rem)' }}>
                        No groups yet
                    </h2>
                    <p className="page-hero-subtitle">
                        Create or join a group first, and SplitX will start building your own money-change journey there.
                    </p>
                    <Button onClick={() => router.push('/groups')}>Open Groups</Button>
                </div>
            </Card>
        );
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <div className="page-hero" style={{ paddingTop: 'var(--space-2)' }}>
                <div className="page-kicker">
                    <HistoryIcon size={14} />
                    History
                </div>
                <h1 className="page-hero-title" style={{ fontSize: 'clamp(2rem, 6vw, 3rem)' }}>
                    Choose a group for your Balance Journey
                </h1>
                <p className="page-hero-subtitle">
                    This history always shows only your own balance changes. Pick a group to see how your amount moved over time.
                </p>
            </div>

            <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
                {groups.map((group, index) => {
                    const preview = previews[group.id];
                    const isPreviewLoading = groups.length > 1 && Object.keys(previews).length === 0;
                    const memberCount = group.members.length;

                    return (
                        <Card key={group.id} padding="normal" interactive glow={index === 0}>
                            <button
                                onClick={() => router.push(`/groups/${group.id}/journey`)}
                                style={{
                                    width: '100%',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: 'var(--space-3)',
                                    textAlign: 'center',
                                    border: 'none',
                                    background: 'transparent',
                                    cursor: 'pointer',
                                    color: 'inherit',
                                }}
                            >
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-2)' }}>
                                    <div style={{
                                        width: 64,
                                        height: 64,
                                        borderRadius: 'var(--radius-2xl)',
                                        background: 'rgba(var(--accent-500-rgb), 0.08)',
                                        border: '1px solid rgba(var(--accent-500-rgb), 0.12)',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        fontSize: 28,
                                    }}>
                                        {group.emoji}
                                    </div>
                                    <div className="font-display" style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--fg-primary)' }}>
                                        {group.name}
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, flexWrap: 'wrap', color: 'var(--fg-tertiary)', fontSize: 'var(--text-xs)', fontWeight: 700 }}>
                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                            <Users size={12} />
                                            {memberCount} members
                                        </span>
                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                            <GitBranch size={12} />
                                            Total spent {formatCurrency(group.totalSpent)}
                                        </span>
                                    </div>
                                </div>

                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 'var(--space-2)' }}>
                                    <MetricCard
                                        label="Your current number"
                                        value={isPreviewLoading ? 'Loading...' : preview ? `${preview.currentBalance >= 0 ? '+' : '-'}${formatCurrency(Math.abs(preview.currentBalance))}` : 'Unavailable'}
                                        accent={preview ? (preview.currentBalance >= 0 ? 'var(--color-success)' : 'var(--color-error)') : undefined}
                                    />
                                    <MetricCard
                                        label="Changes this week"
                                        value={isPreviewLoading ? '...' : preview ? String(preview.changeCountThisWeek) : '0'}
                                    />
                                </div>

                                <div style={{
                                    padding: '14px 16px',
                                    borderRadius: 'var(--radius-2xl)',
                                    background: 'rgba(var(--accent-500-rgb), 0.06)',
                                    border: '1px solid rgba(var(--accent-500-rgb), 0.1)',
                                }}>
                                    <div style={{ fontSize: '11px', color: 'var(--fg-tertiary)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                                        Current route
                                    </div>
                                    <div style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-secondary)', lineHeight: 1.6 }}>
                                        {isPreviewLoading ? 'Loading your current route...' : preview?.currentRouteSummary || 'Open this group to view your full journey.'}
                                    </div>
                                </div>

                                <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: 'var(--accent-500)', fontSize: 'var(--text-sm)', fontWeight: 700 }}>
                                    Open Balance Journey
                                    <ArrowRight size={16} />
                                </div>
                            </button>
                        </Card>
                    );
                })}
            </div>
        </div>
    );
}

function MetricCard({
    label,
    value,
    accent,
}: {
    label: string;
    value: string;
    accent?: string;
}) {
    return (
        <div style={{
            padding: '12px 10px',
            borderRadius: 'var(--radius-2xl)',
            background: 'rgba(var(--accent-500-rgb), 0.05)',
            border: '1px solid rgba(var(--accent-500-rgb), 0.08)',
            textAlign: 'center',
        }}>
            <div style={{ fontSize: '11px', color: 'var(--fg-tertiary)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
                {label}
            </div>
            <div className="font-display" style={{ fontSize: 'var(--text-lg)', fontWeight: 800, color: accent || 'var(--fg-primary)' }}>
                {value}
            </div>
        </div>
    );
}
