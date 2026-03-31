'use client';

import { useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import useSWRInfinite from 'swr/infinite';
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
type DateRangeKey = 'all' | '7d' | '30d';

interface BalanceHistoryCursor {
    beforeCreatedAt: string;
    beforeId: string;
}

interface BalanceHistoryEntry {
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
}

interface BalanceHistoryResponse {
    group: { id: string; name: string; emoji: string };
    user: { id: string; name: string };
    currentBalance: number;
    currentRouteSummary: string;
    changeCountThisWeek: number;
    hasMore: boolean;
    nextCursor: BalanceHistoryCursor | null;
    entries: BalanceHistoryEntry[];
}

const filterOptions: { key: FilterKey; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'expenses', label: 'Expenses' },
    { key: 'settlements', label: 'Settlements' },
    { key: 'edits', label: 'Edits' },
];

const dateRanges: { key: DateRangeKey; label: string }[] = [
    { key: 'all', label: 'All time' },
    { key: '7d', label: 'Last 7 days' },
    { key: '30d', label: 'Last 30 days' },
];

const INITIAL_HISTORY_LIMIT = 12;
const OLDER_HISTORY_LIMIT = 25;

export default function GroupJourneyPage() {
    const params = useParams();
    const router = useRouter();
    const groupId = params.groupId as string;
    const [activeFilter, setActiveFilter] = useState<FilterKey>('all');
    const [dateRange, setDateRange] = useState<DateRangeKey>('all');
    const [expandedEntryId, setExpandedEntryId] = useState<string | null>(null);

    const getKey = (pageIndex: number, previousPageData: BalanceHistoryResponse | null) => {
        if (!isFeatureEnabled('balanceJourney')) return null;
        if (previousPageData && !previousPageData.hasMore) return null;

        const params = new URLSearchParams({
            limit: String(pageIndex === 0 ? INITIAL_HISTORY_LIMIT : OLDER_HISTORY_LIMIT),
            filterKey: activeFilter,
            dateRange,
        });

        if (pageIndex > 0 && previousPageData?.nextCursor) {
            params.set('beforeCreatedAt', previousPageData.nextCursor.beforeCreatedAt);
            params.set('beforeId', previousPageData.nextCursor.beforeId);
        }

        return `/api/groups/${groupId}/balance-history?${params.toString()}`;
    };

    const {
        data,
        error,
        isLoading,
        isValidating,
        size,
        setSize,
    } = useSWRInfinite<BalanceHistoryResponse>(getKey, fetcher, {
        revalidateFirstPage: false,
        persistSize: false,
    });

    const pages = useMemo(() => data ?? [], [data]);
    const firstPage = pages[0];

    const timelineEntries = useMemo(() => {
        const seen = new Set<string>();
        return pages.flatMap((page) => page.entries).filter((entry) => {
            if (seen.has(entry.id)) return false;
            seen.add(entry.id);
            return true;
        });
    }, [pages]);

    const latestEntry = timelineEntries[0] || null;
    const activeExpandedEntryId = expandedEntryId || latestEntry?.id || null;
    const hasMore = pages.length > 0 ? pages[pages.length - 1].hasMore : false;
    const isLoadingMore = isValidating && pages.length > 0 && pages.length === size - 1;

    const handleFilterChange = (nextFilter: FilterKey) => {
        if (nextFilter === activeFilter) return;
        setExpandedEntryId(null);
        setActiveFilter(nextFilter);
        void setSize(1);
    };

    const handleDateRangeChange = (nextRange: DateRangeKey) => {
        if (nextRange === dateRange) return;
        setExpandedEntryId(null);
        setDateRange(nextRange);
        void setSize(1);
    };

    if (!isFeatureEnabled('balanceJourney')) {
        return (
            <Card padding="normal">
                <div style={{ textAlign: 'center', padding: 'var(--space-8) var(--space-4)' }}>
                    Balance Journey is currently unavailable.
                </div>
            </Card>
        );
    }

    if (isLoading && !firstPage) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                {[0, 1, 2].map((index) => (
                    <Card key={index} padding="normal">
                        <div style={{ height: 112, borderRadius: 'var(--radius-lg)', background: 'rgba(var(--accent-500-rgb), 0.06)' }} />
                    </Card>
                ))}
            </div>
        );
    }

    if (error || !firstPage) {
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
                        width: 40,
                        height: 40,
                        borderRadius: 'var(--radius-lg)',
                        border: '1px solid var(--border-glass)',
                        background: 'var(--bg-glass)',
                        color: 'var(--fg-secondary)',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        flexShrink: 0,
                    }}
                >
                    <ArrowLeft size={18} />
                </button>
                <div className="page-hero" style={{ flex: 1, paddingTop: 0 }}>
                    <div className="page-kicker" style={{ margin: '0 auto', width: 'fit-content' }}>
                        <span style={{ fontSize: '18px', lineHeight: 1 }}>{firstPage.group.emoji}</span>
                        {firstPage.group.name}
                    </div>
                    <h1 className="page-hero-title" style={{ fontSize: 'clamp(1.95rem, 6vw, 2.9rem)' }}>
                        Your Balance Journey
                    </h1>
                    <p className="page-hero-subtitle">
                        Open on the newest change first, then load older steps only when you want the full story.
                    </p>
                </div>
                <div style={{ width: 40, flexShrink: 0 }} />
            </div>

            <Card padding="normal" glow>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 'var(--space-3)' }}>
                    <div className="page-kicker">Current Snapshot</div>
                    <div className="font-display" style={{
                        fontSize: 'clamp(2rem, 8vw, 3rem)',
                        fontWeight: 800,
                        color: firstPage.currentBalance >= 0 ? 'var(--color-success)' : 'var(--color-error)',
                        lineHeight: 1,
                    }}>
                        {firstPage.currentBalance >= 0 ? '+' : '-'}{formatCurrency(Math.abs(firstPage.currentBalance))}
                    </div>
                    <p style={{
                        fontSize: 'var(--text-sm)',
                        color: 'var(--fg-secondary)',
                        lineHeight: 1.6,
                        maxWidth: 440,
                        margin: 0,
                    }}>
                        {firstPage.currentRouteSummary}
                    </p>
                    <div style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 10,
                        padding: '12px 16px',
                        borderRadius: 'var(--radius-2xl)',
                        background: 'rgba(var(--accent-500-rgb), 0.08)',
                        border: '1px solid rgba(var(--accent-500-rgb), 0.12)',
                    }}>
                        <span className="font-display" style={{ fontSize: 'var(--text-xl)', fontWeight: 800, color: 'var(--accent-500)' }}>
                            {firstPage.changeCountThisWeek}
                        </span>
                        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                            changes this week
                        </span>
                    </div>
                    <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', justifyContent: 'center' }}>
                        {isFeatureEnabled('balanceJourneyExport') && (
                            <Button
                                size="sm"
                                variant="outline"
                                leftIcon={<Download size={14} />}
                                onClick={() => exportBalanceHistoryAsCSV({
                                    groupName: firstPage.group.name,
                                    groupEmoji: firstPage.group.emoji,
                                    userName: firstPage.user.name,
                                    currentBalance: firstPage.currentBalance,
                                    routeSummary: firstPage.currentRouteSummary,
                                    exportDate: new Date(),
                                    entries: timelineEntries.map((entry) => ({
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
                                onClick={() => router.push(`/groups/${groupId}/journey/print`)}
                            >
                                Print View
                            </Button>
                        )}
                    </div>
                </div>
            </Card>

            {latestEntry && (
                <Card padding="normal" glow>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-3)', textAlign: 'center' }}>
                        <div className="page-kicker">Latest Change</div>
                        <div className="font-display" style={{ fontSize: 'clamp(1.45rem, 5vw, 2rem)', fontWeight: 800, color: 'var(--fg-primary)' }}>
                            {latestEntry.sourceLabel}
                        </div>
                        <p style={{
                            margin: 0,
                            maxWidth: 560,
                            fontSize: 'var(--text-sm)',
                            color: 'var(--fg-secondary)',
                            lineHeight: 1.7,
                        }}>
                            {latestEntry.explanation}
                        </p>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 'var(--space-2)', width: '100%' }}>
                            <StepMetric label="Was at" value={latestEntry.beforeBalance} />
                            <StepMetric label="Changed by" value={latestEntry.delta} accent={latestEntry.delta >= 0 ? 'var(--color-success)' : 'var(--color-error)'} />
                            <StepMetric label="Now at" value={latestEntry.afterBalance} />
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                            <Badge variant={latestEntry.eventType === 'settlement' ? 'accent' : latestEntry.eventType === 'edit' ? 'warning' : 'default'} size="sm">
                                {latestEntry.eventType}
                            </Badge>
                            {latestEntry.beforeRouteSummary !== latestEntry.afterRouteSummary && (
                                <Badge variant="info" size="sm">route changed</Badge>
                            )}
                            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)' }}>
                                {formatDate(latestEntry.createdAt)}
                            </span>
                        </div>
                    </div>
                </Card>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', overflowX: 'auto', paddingBottom: 2, justifyContent: 'center', width: '100%' }}>
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
                            onClick={() => handleFilterChange(option.key)}
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

                <div style={{ display: 'flex', gap: 'var(--space-2)', overflowX: 'auto', paddingBottom: 2, justifyContent: 'center', width: '100%' }}>
                    {dateRanges.map((range) => (
                        <button
                            key={range.key}
                            onClick={() => handleDateRangeChange(range.key)}
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
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                {timelineEntries.length === 0 ? (
                    <Card padding="normal">
                        <div style={{ textAlign: 'center', color: 'var(--fg-tertiary)' }}>
                            No history matches this filter yet.
                        </div>
                    </Card>
                ) : (
                    timelineEntries.map((entry, index) => {
                        const isExpanded = activeExpandedEntryId === entry.id;
                        const routeChanged = entry.beforeRouteSummary !== entry.afterRouteSummary;

                        return (
                            <div key={entry.id} style={{ display: 'grid', gridTemplateColumns: '52px 1fr', gap: 'var(--space-3)', alignItems: 'stretch' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                    {index === 0 ? (
                                        <div style={{
                                            minWidth: 44,
                                            height: 26,
                                            borderRadius: 'var(--radius-full)',
                                            background: 'linear-gradient(135deg, var(--accent-500), var(--accent-600))',
                                            color: '#fff',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            padding: '0 10px',
                                            fontSize: '10px',
                                            fontWeight: 800,
                                            textTransform: 'uppercase',
                                            letterSpacing: '0.08em',
                                            boxShadow: '0 8px 24px rgba(var(--accent-500-rgb), 0.22)',
                                        }}>
                                            Latest
                                        </div>
                                    ) : (
                                        <div style={{
                                            width: 18,
                                            height: 18,
                                            borderRadius: '50%',
                                            background: 'rgba(var(--accent-500-rgb), 0.14)',
                                            border: '4px solid rgba(var(--accent-500-rgb), 0.82)',
                                            boxSizing: 'border-box',
                                        }} />
                                    )}
                                    {index < timelineEntries.length - 1 && (
                                        <div style={{
                                            flex: 1,
                                            width: 2,
                                            marginTop: 8,
                                            borderRadius: 'var(--radius-full)',
                                            background: 'linear-gradient(180deg, rgba(var(--accent-500-rgb), 0.28), rgba(var(--accent-500-rgb), 0.04))',
                                            minHeight: 48,
                                        }} />
                                    )}
                                </div>

                                <Card padding="normal" interactive>
                                    <button
                                        onClick={() => setExpandedEntryId(isExpanded ? null : entry.id)}
                                        style={{
                                            width: '100%',
                                            border: 'none',
                                            background: 'transparent',
                                            padding: 0,
                                            textAlign: 'center',
                                            cursor: 'pointer',
                                            color: 'inherit',
                                        }}
                                    >
                                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-2)' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                                                <Badge variant={entry.eventType === 'settlement' ? 'accent' : entry.eventType === 'edit' ? 'warning' : 'default'} size="sm">
                                                    {entry.eventType}
                                                </Badge>
                                                {routeChanged && <Badge variant="info" size="sm">route changed</Badge>}
                                                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)' }}>
                                                    {formatDate(entry.createdAt)}
                                                </span>
                                            </div>

                                            <div className="font-display" style={{ fontSize: 'var(--text-xl)', fontWeight: 700 }}>
                                                {entry.sourceLabel}
                                            </div>

                                            <p style={{
                                                margin: 0,
                                                fontSize: 'var(--text-sm)',
                                                color: 'var(--fg-secondary)',
                                                lineHeight: 1.6,
                                                maxWidth: 520,
                                            }}>
                                                {entry.explanation}
                                            </p>

                                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 'var(--space-2)', width: '100%' }}>
                                                <StepMetric label="Started at" value={entry.beforeBalance} />
                                                <StepMetric label="Changed by" value={entry.delta} accent={entry.delta >= 0 ? 'var(--color-success)' : 'var(--color-error)'} />
                                                <StepMetric label="Now at" value={entry.afterBalance} />
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
                                            textAlign: 'center',
                                        }}>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                                                <StepStory
                                                    title="Step 1"
                                                    subtitle="You started here"
                                                    value={entry.beforeBalance}
                                                />
                                                <StepStory
                                                    title="Step 2"
                                                    subtitle="This event changed your amount"
                                                    value={entry.delta}
                                                    accent={entry.delta >= 0 ? 'var(--color-success)' : 'var(--color-error)'}
                                                />
                                                <StepStory
                                                    title="Step 3"
                                                    subtitle="You ended here"
                                                    value={entry.afterBalance}
                                                />
                                            </div>

                                            {routeChanged && (
                                                <div style={{
                                                    padding: '14px 16px',
                                                    borderRadius: 'var(--radius-2xl)',
                                                    background: 'rgba(var(--accent-500-rgb), 0.07)',
                                                    border: '1px solid rgba(var(--accent-500-rgb), 0.1)',
                                                }}>
                                                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                                                        <GitBranch size={14} style={{ color: 'var(--accent-500)' }} />
                                                        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                                                            Your route changed
                                                        </span>
                                                    </div>
                                                    <div style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-secondary)', lineHeight: 1.6 }}>
                                                        Before: {entry.beforeRouteSummary}
                                                    </div>
                                                    <div style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-secondary)', lineHeight: 1.6, marginTop: 4 }}>
                                                        Now: {entry.afterRouteSummary}
                                                    </div>
                                                </div>
                                            )}

                                            {entry.counterparties.length > 0 && (
                                                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
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

                                            <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', justifyContent: 'center' }}>
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
                            </div>
                        );
                    })
                )}
            </div>

            {hasMore && (
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                    <Button
                        variant="outline"
                        onClick={() => void setSize(size + 1)}
                        disabled={isLoadingMore}
                    >
                        {isLoadingMore ? 'Loading older changes...' : 'Load older changes'}
                    </Button>
                </div>
            )}
        </div>
    );
}

function StepMetric({
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
            padding: '10px 8px',
            borderRadius: 'var(--radius-2xl)',
            background: 'rgba(var(--accent-500-rgb), 0.06)',
            border: '1px solid rgba(var(--accent-500-rgb), 0.08)',
            textAlign: 'center',
        }}>
            <div style={{ fontSize: '11px', color: 'var(--fg-tertiary)', fontWeight: 700, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                {label}
            </div>
            <div className="font-display" style={{ fontSize: 'var(--text-base)', fontWeight: 700, color: accent || 'var(--fg-primary)' }}>
                {value >= 0 ? '+' : '-'}{formatCurrency(Math.abs(value))}
            </div>
        </div>
    );
}

function StepStory({
    title,
    subtitle,
    value,
    accent,
}: {
    title: string;
    subtitle: string;
    value: number;
    accent?: string;
}) {
    return (
        <div style={{
            display: 'grid',
            gridTemplateColumns: '72px 1fr',
            gap: 'var(--space-3)',
            alignItems: 'center',
            padding: '12px 14px',
            borderRadius: 'var(--radius-2xl)',
            background: 'var(--bg-glass)',
            border: '1px solid var(--border-glass)',
            textAlign: 'left',
        }}>
            <div style={{
                display: 'inline-flex',
                justifyContent: 'center',
                padding: '8px 10px',
                borderRadius: 'var(--radius-full)',
                background: 'rgba(var(--accent-500-rgb), 0.08)',
                color: 'var(--accent-500)',
                fontSize: 'var(--text-xs)',
                fontWeight: 800,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
            }}>
                {title}
            </div>
            <div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)', fontWeight: 700, marginBottom: 4 }}>
                    {subtitle}
                </div>
                <div className="font-display" style={{ fontSize: 'var(--text-lg)', fontWeight: 700, color: accent || 'var(--fg-primary)' }}>
                    {value >= 0 ? '+' : '-'}{formatCurrency(Math.abs(value))}
                </div>
            </div>
        </div>
    );
}
