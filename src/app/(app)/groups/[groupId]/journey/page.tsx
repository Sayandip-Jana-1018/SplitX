'use client';

import { useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import useSWR from 'swr';
import {
    ArrowLeft,
    ChevronDown,
    ChevronUp,
    Download,
    Filter,
    GitBranch,
    Printer,
} from 'lucide-react';
import Button from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import { formatCurrency, formatDate } from '@/lib/utils';
import { exportBalanceHistoryAsCSV } from '@/lib/export';
import { isFeatureEnabled } from '@/lib/featureFlags';

const fetcher = async (url: string) => {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error('Failed to load balance journey');
    }
    return response.json();
};

type FilterKey = 'all' | 'expenses' | 'settlements' | 'edits';

interface BalanceHistoryResponse {
    group: { id: string; name: string; emoji: string };
    user: { id: string; name: string };
    currentBalance: number;
    currentRouteSummary: string;
    changeCountThisWeek: number;
    currentSettlements: {
        from: string;
        to: string;
        amount: number;
        fromName: string;
        toName: string;
    }[];
    entries: {
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
        filterKey: FilterKey;
        beforeRouteSummary: string;
        afterRouteSummary: string;
    }[];
}

const filterOptions: { key: FilterKey; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'expenses', label: 'Expenses' },
    { key: 'settlements', label: 'Settlements' },
    { key: 'edits', label: 'Edits' },
];

export default function GroupJourneyPage() {
    const params = useParams();
    const router = useRouter();
    const groupId = params.groupId as string;
    const [activeFilter, setActiveFilter] = useState<FilterKey>('all');
    const [dateRange, setDateRange] = useState<'all' | '7d' | '30d'>('all');
    const [expandedEntryId, setExpandedEntryId] = useState<string | null>(null);
    const [referenceTime] = useState(() => Date.now());

    const { data, error, isLoading } = useSWR<BalanceHistoryResponse>(
        isFeatureEnabled('balanceJourney') ? `/api/groups/${groupId}/balance-history?limit=120` : null,
        fetcher
    );

    const filteredEntries = useMemo(() => {
        if (!data) return [];
        return data.entries.filter((entry) => {
            const filterMatches = activeFilter === 'all' || entry.filterKey === activeFilter;
            const age = referenceTime - new Date(entry.createdAt).getTime();
            const dateMatches = dateRange === 'all'
                || (dateRange === '7d' && age <= 7 * 24 * 60 * 60 * 1000)
                || (dateRange === '30d' && age <= 30 * 24 * 60 * 60 * 1000);
            return filterMatches && dateMatches;
        });
    }, [activeFilter, data, dateRange, referenceTime]);

    const activeExpandedEntryId = expandedEntryId || filteredEntries[0]?.id || null;

    if (!isFeatureEnabled('balanceJourney')) {
        return (
            <Card padding="normal">
                <div style={{ textAlign: 'center', padding: 'var(--space-8) var(--space-4)' }}>
                    Balance Journey is currently unavailable.
                </div>
            </Card>
        );
    }

    if (isLoading) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                {[0, 1, 2].map((index) => (
                    <Card key={index} padding="normal">
                        <div style={{ height: 96, borderRadius: 'var(--radius-lg)', background: 'rgba(var(--accent-500-rgb), 0.06)' }} />
                    </Card>
                ))}
            </div>
        );
    }

    if (error || !data) {
        return (
            <Card padding="normal">
                <div style={{ textAlign: 'center', padding: 'var(--space-8) var(--space-4)' }}>
                    <p style={{ marginBottom: 'var(--space-3)', color: 'var(--fg-secondary)' }}>
                        We could not load this balance journey right now.
                    </p>
                    <Button onClick={() => router.refresh()}>Try Again</Button>
                </div>
            </Card>
        );
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', paddingTop: 'var(--space-2)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
                <button
                    onClick={() => router.push(`/groups/${groupId}`)}
                    style={{
                        width: 36,
                        height: 36,
                        borderRadius: 'var(--radius-lg)',
                        border: '1px solid var(--border-glass)',
                        background: 'var(--bg-glass)',
                        color: 'var(--fg-secondary)',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                    }}
                >
                    <ArrowLeft size={18} />
                </button>
                <div style={{ flex: 1, textAlign: 'center' }}>
                    <div className="page-kicker" style={{ margin: '0 auto var(--space-2)', width: 'fit-content' }}>
                        <span style={{ fontSize: '18px', lineHeight: 1 }}>{data.group.emoji}</span>
                        {data.group.name}
                    </div>
                    <h1 className="page-hero-title" style={{ fontSize: 'clamp(1.9rem, 6vw, 2.8rem)' }}>Balance Journey</h1>
                    <p className="page-hero-subtitle">
                        See exactly how expenses, edits, and settlements moved your balance over time.
                    </p>
                </div>
                <div style={{ width: 36 }} />
            </div>

            <Card padding="normal" glow>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
                        <div>
                            <div style={{
                                fontSize: 'var(--text-xs)',
                                textTransform: 'uppercase',
                                letterSpacing: '0.08em',
                                color: 'var(--fg-tertiary)',
                                fontWeight: 700,
                                marginBottom: 6,
                            }}>
                                Current Balance
                            </div>
                            <div className="font-display" style={{
                                fontSize: 'var(--text-2xl)',
                                fontWeight: 800,
                                color: data.currentBalance >= 0 ? 'var(--color-success)' : 'var(--color-error)',
                            }}>
                                {data.currentBalance >= 0 ? '+' : '-'}{formatCurrency(Math.abs(data.currentBalance))}
                            </div>
                        </div>
                        <div style={{
                            minWidth: 108,
                            textAlign: 'center',
                            padding: '12px',
                            borderRadius: 'var(--radius-xl)',
                            background: 'rgba(var(--accent-500-rgb), 0.08)',
                            border: '1px solid rgba(var(--accent-500-rgb), 0.1)',
                        }}>
                            <div style={{ fontSize: 'var(--text-xl)', fontWeight: 800, color: 'var(--accent-500)' }}>
                                {data.changeCountThisWeek}
                            </div>
                            <div style={{ fontSize: '11px', color: 'var(--fg-tertiary)', fontWeight: 700 }}>
                                changes this week
                            </div>
                        </div>
                    </div>

                    <div style={{
                        padding: '12px 14px',
                        borderRadius: 'var(--radius-xl)',
                        background: 'rgba(var(--accent-500-rgb), 0.05)',
                        border: '1px solid rgba(var(--accent-500-rgb), 0.08)',
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                            <GitBranch size={14} style={{ color: 'var(--accent-500)' }} />
                            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)', fontWeight: 700 }}>
                                Current route
                            </span>
                        </div>
                        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-primary)', fontWeight: 600 }}>
                            {data.currentRouteSummary}
                        </div>
                    </div>

                    <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                        {isFeatureEnabled('balanceJourneyExport') && (
                            <Button
                                size="sm"
                                variant="outline"
                                leftIcon={<Download size={14} />}
                                onClick={() => exportBalanceHistoryAsCSV({
                                    groupName: data.group.name,
                                    groupEmoji: data.group.emoji,
                                    userName: data.user.name,
                                    currentBalance: data.currentBalance,
                                    routeSummary: data.currentRouteSummary,
                                    exportDate: new Date(),
                                    entries: data.entries.map((entry) => ({
                                        date: entry.createdAt,
                                        eventType: entry.eventType,
                                        sourceLabel: entry.sourceLabel,
                                        beforeBalance: entry.beforeBalance,
                                        delta: entry.delta,
                                        afterBalance: entry.afterBalance,
                                        counterparties: entry.counterparties,
                                        explanation: entry.explanation,
                                    })),
                                })}
                            >
                                Export CSV
                            </Button>
                        )}
                        {isFeatureEnabled('balanceJourneyExport') && (
                            <Button
                                size="sm"
                                variant="secondary"
                                leftIcon={<Printer size={14} />}
                                onClick={() => window.open(`/groups/${groupId}/journey/print`, '_blank')}
                            >
                                Print / PDF
                            </Button>
                        )}
                    </div>
                </div>
            </Card>

            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', overflowX: 'auto', paddingBottom: 2 }}>
                <div style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '8px 10px',
                    borderRadius: 'var(--radius-full)',
                    border: '1px solid var(--border-glass)',
                    background: 'var(--bg-glass)',
                    color: 'var(--fg-tertiary)',
                    fontSize: 'var(--text-xs)',
                    fontWeight: 700,
                    whiteSpace: 'nowrap',
                }}>
                    <Filter size={12} />
                    Filter
                </div>
                {filterOptions.map((option) => (
                    <button
                        key={option.key}
                        onClick={() => setActiveFilter(option.key)}
                        style={{
                            border: 'none',
                            cursor: 'pointer',
                            whiteSpace: 'nowrap',
                            padding: '8px 12px',
                            borderRadius: 'var(--radius-full)',
                            background: activeFilter === option.key
                                ? 'linear-gradient(135deg, var(--accent-500), var(--accent-600))'
                                : 'var(--bg-glass)',
                            color: activeFilter === option.key ? '#fff' : 'var(--fg-secondary)',
                            fontSize: 'var(--text-xs)',
                            fontWeight: 700,
                            borderWidth: 1,
                            borderStyle: 'solid',
                            borderColor: activeFilter === option.key ? 'transparent' : 'var(--border-glass)',
                        }}
                    >
                        {option.label}
                    </button>
                ))}
            </div>

            <div style={{ display: 'flex', gap: 'var(--space-2)', overflowX: 'auto', paddingBottom: 2 }}>
                {[
                    { key: 'all', label: 'All time' },
                    { key: '7d', label: 'Last 7 days' },
                    { key: '30d', label: 'Last 30 days' },
                ].map((range) => (
                    <button
                        key={range.key}
                        onClick={() => setDateRange(range.key as 'all' | '7d' | '30d')}
                        style={{
                            border: '1px solid var(--border-glass)',
                            cursor: 'pointer',
                            whiteSpace: 'nowrap',
                            padding: '8px 12px',
                            borderRadius: 'var(--radius-full)',
                            background: dateRange === range.key ? 'rgba(var(--accent-500-rgb), 0.12)' : 'var(--bg-glass)',
                            color: dateRange === range.key ? 'var(--accent-500)' : 'var(--fg-secondary)',
                            fontSize: 'var(--text-xs)',
                            fontWeight: 700,
                        }}
                    >
                        {range.label}
                    </button>
                ))}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                {filteredEntries.length === 0 ? (
                    <Card padding="normal">
                        <div style={{ textAlign: 'center', color: 'var(--fg-tertiary)' }}>
                            No history matches this filter yet.
                        </div>
                    </Card>
                ) : (
                    filteredEntries.map((entry) => {
                        const isExpanded = activeExpandedEntryId === entry.id;
                        return (
                            <Card key={entry.id} padding="normal" interactive>
                                <button
                                    onClick={() => setExpandedEntryId(isExpanded ? null : entry.id)}
                                    style={{
                                        width: '100%',
                                        border: 'none',
                                        background: 'transparent',
                                        padding: 0,
                                        textAlign: 'left',
                                        cursor: 'pointer',
                                        color: 'inherit',
                                    }}
                                >
                                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
                                        <div style={{ flex: 1 }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap', marginBottom: 8 }}>
                                                <Badge variant={entry.eventType === 'settlement' ? 'accent' : entry.eventType === 'edit' ? 'warning' : 'default'} size="sm">
                                                    {entry.eventType}
                                                </Badge>
                                                {entry.beforeRouteSummary !== entry.afterRouteSummary && (
                                                    <Badge variant="info" size="sm">route changed</Badge>
                                                )}
                                                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)' }}>
                                                    {formatDate(entry.createdAt)}
                                                </span>
                                            </div>
                                            <div style={{ fontSize: 'var(--text-base)', fontWeight: 700, marginBottom: 6 }}>
                                                {entry.sourceLabel}
                                            </div>
                                            <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                                                <MetricPill label="Before" value={entry.beforeBalance} />
                                                <MetricPill
                                                    label="Delta"
                                                    value={entry.delta}
                                                    accent={entry.delta >= 0 ? 'var(--color-success)' : 'var(--color-error)'}
                                                />
                                                <MetricPill label="After" value={entry.afterBalance} />
                                            </div>
                                        </div>
                                        <div style={{ color: 'var(--fg-tertiary)' }}>
                                            {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                                        </div>
                                    </div>
                                </button>

                                {isExpanded && (
                                    <div style={{
                                        marginTop: 'var(--space-3)',
                                        paddingTop: 'var(--space-3)',
                                        borderTop: '1px solid var(--border-subtle)',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: 'var(--space-3)',
                                    }}>
                                        <div>
                                            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)', fontWeight: 700, marginBottom: 6 }}>
                                                Why did this change?
                                            </div>
                                            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-secondary)', lineHeight: 1.6 }}>
                                                {entry.explanation}
                                            </div>
                                        </div>
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)' }}>
                                            <RouteBox label="Before route" value={entry.beforeRouteSummary} />
                                            <RouteBox label="After route" value={entry.afterRouteSummary} />
                                        </div>
                                        {entry.counterparties.length > 0 && (
                                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                                {entry.counterparties.map((name) => (
                                                    <span
                                                        key={`${entry.id}-${name}`}
                                                        style={{
                                                            padding: '6px 10px',
                                                            borderRadius: 'var(--radius-full)',
                                                            background: 'rgba(var(--accent-500-rgb), 0.08)',
                                                            color: 'var(--fg-secondary)',
                                                            fontSize: 'var(--text-xs)',
                                                            fontWeight: 600,
                                                        }}
                                                    >
                                                        {name}
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={() => router.push(entry.eventType === 'settlement' ? '/settlements' : `/transactions?focus=${entry.sourceId}`)}
                                            >
                                                {entry.eventType === 'settlement' ? 'Open Settlements' : 'Open Transaction'}
                                            </Button>
                                        </div>
                                    </div>
                                )}
                            </Card>
                        );
                    })
                )}
            </div>
        </div>
    );
}

function MetricPill({
    label,
    value,
    accent,
}: {
    label: string;
    value: number;
    accent?: string;
}) {
    return (
        <div style={{
            padding: '8px 10px',
            borderRadius: 'var(--radius-xl)',
            background: 'rgba(var(--accent-500-rgb), 0.06)',
            border: '1px solid rgba(var(--accent-500-rgb), 0.08)',
            minWidth: 96,
        }}>
            <div style={{ fontSize: '11px', color: 'var(--fg-tertiary)', fontWeight: 700, marginBottom: 2 }}>
                {label}
            </div>
            <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: accent || 'var(--fg-primary)' }}>
                {value >= 0 ? '+' : '-'}{formatCurrency(Math.abs(value))}
            </div>
        </div>
    );
}

function RouteBox({ label, value }: { label: string; value: string }) {
    return (
        <div style={{
            padding: '10px 12px',
            borderRadius: 'var(--radius-xl)',
            background: 'var(--bg-glass)',
            border: '1px solid var(--border-glass)',
        }}>
            <div style={{ fontSize: '11px', color: 'var(--fg-tertiary)', fontWeight: 700, marginBottom: 4 }}>
                {label}
            </div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-secondary)', lineHeight: 1.5 }}>
                {value}
            </div>
        </div>
    );
}
