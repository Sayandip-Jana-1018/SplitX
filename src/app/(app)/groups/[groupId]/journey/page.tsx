'use client';

import { useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import useSWRInfinite from 'swr/infinite';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRightLeft, ChevronDown, Download, GitBranch, History, PencilLine, Printer, ReceiptText } from 'lucide-react';
import Button from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import Skeleton, { ListSkeleton } from '@/components/ui/Skeleton';
import { Amount, Chip, ChipRow, IconTile, Notice, Segmented, Stagger, StaggerItem, Tag } from '@/components/ui/kit';
import { exportBalanceHistoryAsCSV } from '@/lib/export';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { getNetworkErrorCopy, NetworkTaggedError } from '@/lib/networkErrors';
import { fetcher } from '@/lib/swr';
import { cn, formatCurrency, formatDate } from '@/lib/utils';
import styles from './journey.module.css';

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

const FILTER_OPTIONS: { value: FilterKey; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'expenses', label: 'Expenses' },
    { value: 'settlements', label: 'Settled' },
    { value: 'edits', label: 'Edits' },
];

const DATE_RANGES: { key: DateRangeKey; label: string }[] = [
    { key: 'all', label: 'All time' },
    { key: '7d', label: 'Last 7 days' },
    { key: '30d', label: 'Last 30 days' },
];

const EVENT_META = {
    expense: { label: 'Expense', Icon: ReceiptText, tone: 'neutral' },
    settlement: { label: 'Settlement', Icon: ArrowRightLeft, tone: 'success' },
    edit: { label: 'Edit', Icon: PencilLine, tone: 'warning' },
} as const;

const INITIAL_HISTORY_LIMIT = 12;
const OLDER_HISTORY_LIMIT = 25;

const signed = (paise: number) => `${paise > 0 ? '+' : paise < 0 ? '−' : ''}${formatCurrency(Math.abs(paise))}`;

export default function GroupJourneyPage() {
    const params = useParams();
    const router = useRouter();
    const groupId = params.groupId as string;
    const enabled = isFeatureEnabled('balanceJourney');
    const exportEnabled = isFeatureEnabled('balanceJourneyExport');

    const [activeFilter, setActiveFilter] = useState<FilterKey>('all');
    const [dateRange, setDateRange] = useState<DateRangeKey>('all');
    // undefined → latest entry open by default; null → everything collapsed
    const [expanded, setExpanded] = useState<string | null | undefined>(undefined);

    const getKey = (pageIndex: number, previousPage: BalanceHistoryResponse | null) => {
        if (!enabled) return null;
        if (previousPage && !previousPage.hasMore) return null;

        const search = new URLSearchParams({
            limit: String(pageIndex === 0 ? INITIAL_HISTORY_LIMIT : OLDER_HISTORY_LIMIT),
            filterKey: activeFilter,
            dateRange,
        });
        if (pageIndex > 0 && previousPage?.nextCursor) {
            search.set('beforeCreatedAt', previousPage.nextCursor.beforeCreatedAt);
            search.set('beforeId', previousPage.nextCursor.beforeId);
        }
        return `/api/groups/${groupId}/balance-history?${search.toString()}`;
    };

    const { data, error, isLoading, isValidating, size, setSize, mutate } = useSWRInfinite<BalanceHistoryResponse>(
        getKey,
        fetcher,
        { revalidateFirstPage: false, persistSize: false }
    );

    const pages = useMemo(() => data ?? [], [data]);
    const firstPage = pages[0];

    const entries = useMemo(() => {
        const seen = new Set<string>();
        return pages.flatMap((page) => page.entries).filter((entry) => {
            if (seen.has(entry.id)) return false;
            seen.add(entry.id);
            return true;
        });
    }, [pages]);

    const openId = expanded === undefined ? entries[0]?.id ?? null : expanded;
    const hasMore = pages.length > 0 ? pages[pages.length - 1].hasMore : false;
    const isLoadingMore = isValidating && pages.length > 0 && pages.length === size - 1;

    const changeFilter = (next: FilterKey) => {
        if (next === activeFilter) return;
        setExpanded(undefined);
        setActiveFilter(next);
        void setSize(1);
    };

    const changeRange = (next: DateRangeKey) => {
        if (next === dateRange) return;
        setExpanded(undefined);
        setDateRange(next);
        void setSize(1);
    };

    if (!enabled) {
        return (
            <EmptyState
                icon={<GitBranch size={26} />}
                title="Balance journey is coming soon"
                description="We’re polishing a step-by-step replay of how your balance changes."
                actionLabel="Back to group"
                actionHref={`/groups/${groupId}`}
            />
        );
    }

    if (isLoading && !firstPage) {
        return (
            <div className={styles.page}>
                <Skeleton variant="rectangular" height={250} radius={28} />
                <Skeleton variant="rectangular" height={44} radius="var(--radius-full)" />
                <ListSkeleton rows={4} />
            </div>
        );
    }

    if (error || !firstPage) {
        const variant = error instanceof NetworkTaggedError ? error.variant : 'default';
        const copy = getNetworkErrorCopy(variant);
        return <ErrorState variant={variant} title={copy.title} message={copy.message} onRetry={() => mutate()} />;
    }

    const balance = firstPage.currentBalance;
    const weekCount = firstPage.changeCountThisWeek;

    const exportCsv = () => exportBalanceHistoryAsCSV({
        groupName: firstPage.group.name,
        groupEmoji: firstPage.group.emoji,
        userName: firstPage.user.name,
        currentBalance: balance,
        routeSummary: firstPage.currentRouteSummary,
        exportDate: new Date(),
        entries: entries.map((entry) => ({
            date: entry.createdAt,
            eventType: entry.eventType,
            sourceLabel: entry.sourceLabel,
            beforeBalance: entry.beforeBalance,
            delta: entry.delta,
            afterBalance: entry.afterBalance,
            counterparties: entry.counterparties,
            explanation: entry.explanation,
        })),
    });

    return (
        <Stagger className={styles.page}>
            {/* ── Snapshot ── */}
            <StaggerItem>
                <section className={styles.hero}>
                    <span className={styles.heroChip}>
                        <span aria-hidden="true">{firstPage.group.emoji}</span>
                        <span className={styles.heroChipText}>{firstPage.group.name}</span>
                    </span>
                    <span className={styles.heroLabel}>
                        {balance > 0 ? 'You get back' : balance < 0 ? 'You owe' : 'Your balance'}
                    </span>
                    <span className={cn(styles.heroAmount, balance > 0 && styles.positive, balance < 0 && styles.negative)}>
                        {balance === 0 ? 'All settled' : formatCurrency(Math.abs(balance))}
                    </span>
                    <p className={styles.heroRoute}>{firstPage.currentRouteSummary}</p>
                    <div className={styles.heroMeta}>
                        <Tag tone="accent" icon={<History size={11} />}>
                            {weekCount} {weekCount === 1 ? 'change' : 'changes'} this week
                        </Tag>
                    </div>
                    {exportEnabled && (
                        <div className={styles.heroActions}>
                            <Button size="sm" variant="secondary" leftIcon={<Download size={14} />} onClick={exportCsv}>
                                Export CSV
                            </Button>
                            <Button
                                size="sm"
                                variant="ghost"
                                leftIcon={<Printer size={14} />}
                                onClick={() => router.push(`/groups/${groupId}/journey/print`)}
                            >
                                Print
                            </Button>
                        </div>
                    )}
                </section>
            </StaggerItem>

            {/* ── Filters ── */}
            <StaggerItem>
                <div className={styles.filters}>
                    <Segmented<FilterKey>
                        ariaLabel="Filter changes"
                        size="sm"
                        value={activeFilter}
                        onChange={changeFilter}
                        options={FILTER_OPTIONS}
                    />
                    <ChipRow center>
                        {DATE_RANGES.map((range) => (
                            <Chip key={range.key} active={dateRange === range.key} onClick={() => changeRange(range.key)}>
                                {range.label}
                            </Chip>
                        ))}
                    </ChipRow>
                </div>
            </StaggerItem>

            {/* ── Timeline ── */}
            <StaggerItem>
                {entries.length === 0 ? (
                    <EmptyState
                        compact
                        icon={<GitBranch size={22} />}
                        title="No changes here"
                        description="Nothing matches this filter yet — try a wider date range."
                    />
                ) : (
                    <ol className={styles.timeline}>
                        {entries.map((entry, index) => {
                            const meta = EVENT_META[entry.eventType] ?? EVENT_META.expense;
                            const open = openId === entry.id;
                            const routeChanged = entry.beforeRouteSummary !== entry.afterRouteSummary;
                            return (
                                <li key={entry.id} className={styles.entry}>
                                    <div className={styles.rail} aria-hidden="true">
                                        <span className={cn(styles.dot, index === 0 && styles.dotLatest)} />
                                        {index < entries.length - 1 && <span className={styles.line} />}
                                    </div>
                                    <div className={cn(styles.card, open && styles.cardOpen)}>
                                        <button
                                            type="button"
                                            className={styles.cardHead}
                                            onClick={() => setExpanded(open ? null : entry.id)}
                                            aria-expanded={open}
                                        >
                                            <IconTile tone={meta.tone} size={38}><meta.Icon size={17} /></IconTile>
                                            <span className={styles.cardText}>
                                                <span className={styles.cardTitle}>{entry.sourceLabel}</span>
                                                <span className={styles.cardSub}>
                                                    {index === 0 && <Tag tone="accent">Latest</Tag>}
                                                    {meta.label} · {formatDate(entry.createdAt)}
                                                </span>
                                            </span>
                                            <span className={styles.cardRight}>
                                                <Amount value={entry.delta} tone="auto" signed />
                                                <ChevronDown size={16} className={cn(styles.chevron, open && styles.chevronOpen)} />
                                            </span>
                                        </button>

                                        <AnimatePresence initial={false}>
                                            {open && (
                                                <motion.div
                                                    key="details"
                                                    className={styles.cardBodyWrap}
                                                    initial={{ height: 0, opacity: 0 }}
                                                    animate={{ height: 'auto', opacity: 1 }}
                                                    exit={{ height: 0, opacity: 0 }}
                                                    transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
                                                >
                                                    <div className={styles.cardBody}>
                                                        <p className={styles.explanation}>{entry.explanation}</p>
                                                        <div className={styles.steps}>
                                                            <div className={styles.step}>
                                                                <span className={styles.stepLabel}>Was</span>
                                                                <span className={styles.stepValue}>{signed(entry.beforeBalance)}</span>
                                                            </div>
                                                            <div className={cn(styles.step, entry.delta > 0 && styles.stepUp, entry.delta < 0 && styles.stepDown)}>
                                                                <span className={styles.stepLabel}>Change</span>
                                                                <span className={styles.stepValue}>{signed(entry.delta)}</span>
                                                            </div>
                                                            <div className={styles.step}>
                                                                <span className={styles.stepLabel}>Now</span>
                                                                <span className={styles.stepValue}>{signed(entry.afterBalance)}</span>
                                                            </div>
                                                        </div>
                                                        {routeChanged && (
                                                            <Notice tone="info" icon={<GitBranch size={16} />} title="Who you settle with changed">
                                                                <span className={styles.routeLine}>Before: {entry.beforeRouteSummary}</span>
                                                                <span className={styles.routeLine}>Now: {entry.afterRouteSummary}</span>
                                                            </Notice>
                                                        )}
                                                        {entry.counterparties.length > 0 && (
                                                            <div className={styles.people}>
                                                                {entry.counterparties.map((name, personIndex) => (
                                                                    <Tag key={`${name}-${personIndex}`}>{name}</Tag>
                                                                ))}
                                                            </div>
                                                        )}
                                                        <Button
                                                            size="sm"
                                                            variant="secondary"
                                                            fullWidth
                                                            onClick={() => router.push(entry.eventType === 'settlement'
                                                                ? '/settlements'
                                                                : `/transactions?focus=${entry.sourceId}`)}
                                                        >
                                                            {entry.eventType === 'settlement' ? 'Open Settle up' : 'Open expense'}
                                                        </Button>
                                                    </div>
                                                </motion.div>
                                            )}
                                        </AnimatePresence>
                                    </div>
                                </li>
                            );
                        })}
                    </ol>
                )}
            </StaggerItem>

            {hasMore && (
                <StaggerItem>
                    <div className={styles.loadMore}>
                        <Button variant="secondary" loading={isLoadingMore} onClick={() => void setSize(size + 1)}>
                            Load older changes
                        </Button>
                    </div>
                </StaggerItem>
            )}
        </Stagger>
    );
}
