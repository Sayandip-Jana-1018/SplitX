'use client';

import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import useSWR from 'swr';
import { motion } from 'framer-motion';
import { AlertTriangle, ArrowDownRight, ArrowUpRight, CheckCircle2, Crown, Plus, ReceiptText, Sparkles, Users } from 'lucide-react';
import Avatar from '@/components/ui/Avatar';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import Skeleton from '@/components/ui/Skeleton';
import { CategoryTile, getCategoryConfig } from '@/components/ui/Icons';
import { Chip, ChipRow, Notice, Section, Stagger, StaggerItem } from '@/components/ui/kit';
import { useAnimatedNumber } from '@/hooks/useAnimatedNumber';
import { getNetworkErrorCopy, NetworkTaggedError } from '@/lib/networkErrors';
import { fetcher } from '@/lib/swr';
import { cn, formatCurrency } from '@/lib/utils';
import styles from './analytics.module.css';

const MonthlyTrendChart = dynamic(
    () => import('@/components/charts/SpendingCharts').then((mod) => mod.MonthlyTrendChart),
    { ssr: false, loading: () => <div className={styles.chartFallback} /> }
);
const CategoryDonut = dynamic(
    () => import('@/components/charts/SpendingCharts').then((mod) => mod.CategoryDonut),
    { ssr: false, loading: () => <div className={styles.donutFallback} /> }
);

interface GroupOption {
    id: string;
    name: string;
    emoji: string;
    memberCount: number;
    totalSpent: number;
}

interface AnalyticsData {
    monthlyTrend: { month: string; total: number }[];
    categoryBreakdown: { category: string; label: string; amount: number; percentage: number }[];
    memberSpending: { name: string; amount: number; image?: string | null }[];
    insights: { type: string; message: string; severity: 'info' | 'warning' | 'success' }[];
    currentMonth: string;
    totalThisMonth: number;
    transactionCount: number;
    memberCount: number;
    groupName: string | null;
    groupEmoji: string | null;
}

interface AnalyticsPayload {
    groups: GroupOption[];
    selectedGroupId: string | null;
    data: AnalyticsData;
}

const barSpring = { type: 'spring', stiffness: 140, damping: 24 } as const;

function monthName(key: string, style: 'long' | 'short' = 'long') {
    const match = /^(\d{4})-(\d{2})$/.exec(key);
    if (!match) return key;
    return new Date(Number(match[1]), Number(match[2]) - 1, 1).toLocaleDateString('en-IN', { month: style });
}

function InsightIcon({ severity }: { severity: 'info' | 'warning' | 'success' }) {
    if (severity === 'warning') return <AlertTriangle size={16} />;
    if (severity === 'success') return <CheckCircle2 size={16} />;
    return <Sparkles size={16} />;
}

export default function AnalyticsPage() {
    const [groupId, setGroupId] = useState<string | null>(null);
    const key = groupId ? `/api/analytics?groupId=${encodeURIComponent(groupId)}` : '/api/analytics';
    const { data: payload, error, isLoading, mutate } = useSWR<AnalyticsPayload>(key, fetcher, {
        keepPreviousData: true,
        revalidateOnFocus: false,
    });

    const analytics = payload?.data;
    const groups = payload?.groups ?? [];
    const selectedId = payload?.selectedGroupId ?? null;
    const selectedGroup = groups.find((group) => group.id === selectedId) ?? null;
    const switching = groupId !== null && selectedId !== groupId;

    const trend = useMemo(
        () => (analytics?.monthlyTrend ?? []).map((point, index, all) => ({
            label: monthName(point.month, 'short'),
            amount: point.total,
            current: index === all.length - 1,
        })),
        [analytics]
    );

    const categories = useMemo(
        () => (analytics?.categoryBreakdown ?? []).map((item) => {
            const config = getCategoryConfig(item.category);
            return { ...item, label: item.label || config.label, color: config.color };
        }),
        [analytics]
    );

    const totalThisMonth = analytics?.totalThisMonth ?? 0;
    const animatedTotal = useAnimatedNumber(totalThisMonth, 900, formatCurrency);
    const previousMonth = analytics?.monthlyTrend.at(-2)?.total ?? 0;
    const delta = previousMonth ? Math.round(((totalThisMonth - previousMonth) / previousMonth) * 100) : null;
    const categoriesTotal = categories.reduce((sum, item) => sum + item.amount, 0);
    const members = analytics?.memberSpending ?? [];
    const paidTotal = members.reduce((sum, member) => sum + member.amount, 0);
    const topPaid = members[0]?.amount ?? 0;
    const hasData = Boolean(
        analytics && (analytics.monthlyTrend.some((point) => point.total > 0) || analytics.categoryBreakdown.length > 0)
    );

    if (isLoading && !payload) {
        return (
            <div className={styles.page}>
                <Skeleton variant="rectangular" height={250} radius={28} />
                <Skeleton variant="rectangular" height={260} radius={22} />
                <Skeleton variant="rectangular" height={340} radius={22} />
            </div>
        );
    }

    if (error && !payload) {
        const variant = error instanceof NetworkTaggedError ? error.variant : 'default';
        const copy = getNetworkErrorCopy(variant);
        return <ErrorState variant={variant} title={copy.title} message={copy.message} onRetry={() => mutate()} />;
    }

    if (!analytics || groups.length === 0) {
        return (
            <div className={styles.page}>
                <EmptyState
                    icon={<Users size={26} />}
                    title="No groups yet"
                    description="Create a group and add a few expenses — your spending story shows up here."
                    actionLabel="Create a group"
                    actionHref="/groups?create=1"
                    actionIcon={<Plus size={16} />}
                />
            </div>
        );
    }

    const groupName = analytics.groupName || selectedGroup?.name || 'Your group';
    const groupEmoji = analytics.groupEmoji || selectedGroup?.emoji || '✨';
    const averageExpense = analytics.transactionCount ? Math.round(totalThisMonth / analytics.transactionCount) : 0;
    const perPerson = analytics.memberCount ? Math.round(totalThisMonth / analytics.memberCount) : 0;

    return (
        <Stagger className={styles.page}>
            {groups.length > 1 && (
                <StaggerItem>
                    <ChipRow center>
                        {groups.map((group) => (
                            <Chip
                                key={group.id}
                                active={group.id === (groupId ?? selectedId)}
                                onClick={() => setGroupId(group.id)}
                                icon={<span aria-hidden="true">{group.emoji}</span>}
                            >
                                {group.name}
                            </Chip>
                        ))}
                    </ChipRow>
                </StaggerItem>
            )}

            {/* ── This month ── */}
            <StaggerItem>
                <section className={cn(styles.hero, switching && styles.heroBusy)} aria-busy={switching}>
                    <span className={styles.heroChip}>
                        <span aria-hidden="true">{groupEmoji}</span>
                        <span className={styles.heroChipText}>{groupName}</span>
                    </span>
                    <span className={styles.heroLabel}>Spent in {monthName(analytics.currentMonth)}</span>
                    <span className={styles.heroAmount}>{animatedTotal}</span>
                    <span className={styles.heroDelta}>
                        {delta === null ? (
                            'First month on SplitX'
                        ) : delta === 0 ? (
                            'Same as last month'
                        ) : (
                            <>
                                {delta > 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                                {Math.abs(delta)}% vs last month
                            </>
                        )}
                    </span>
                    <div className={styles.heroStats}>
                        <div className={styles.heroStat}>
                            <span className={styles.heroStatValue}>{analytics.transactionCount}</span>
                            <span className={styles.heroStatLabel}>Expenses</span>
                        </div>
                        <div className={styles.heroStat}>
                            <span className={styles.heroStatValue}>{formatCurrency(averageExpense)}</span>
                            <span className={styles.heroStatLabel}>Avg. expense</span>
                        </div>
                        <div className={styles.heroStat}>
                            <span className={styles.heroStatValue}>{formatCurrency(perPerson)}</span>
                            <span className={styles.heroStatLabel}>Per person</span>
                        </div>
                    </div>
                </section>
            </StaggerItem>

            {!hasData ? (
                <StaggerItem>
                    <EmptyState
                        icon={<ReceiptText size={26} />}
                        title={`Nothing logged in ${groupName} yet`}
                        description="Add a few expenses and your trends, categories and insights appear here."
                        actionLabel="Add expense"
                        actionHref={selectedId ? `/transactions/new?groupId=${selectedId}` : '/transactions/new'}
                        actionIcon={<Plus size={16} />}
                    />
                </StaggerItem>
            ) : (
                <>
                    {/* ── Trend ── */}
                    <StaggerItem>
                        <Section title="Monthly trend" subtitle="How this group’s spending moves">
                            <div className={styles.card}>
                                <MonthlyTrendChart data={trend} />
                            </div>
                        </Section>
                    </StaggerItem>

                    {/* ── Categories ── */}
                    <StaggerItem>
                        <Section title="Where it went" subtitle={`${monthName(analytics.currentMonth)} by category`}>
                            {categories.length > 0 ? (
                                <div className={styles.card}>
                                    <div className={styles.donutWrap}>
                                        <CategoryDonut
                                            data={categories.map((item) => ({
                                                key: item.category,
                                                label: item.label,
                                                value: item.amount,
                                                color: item.color,
                                            }))}
                                            total={categoriesTotal}
                                            caption={`${categories.length} ${categories.length === 1 ? 'category' : 'categories'}`}
                                        />
                                    </div>
                                    <div className={styles.list}>
                                        {categories.map((item) => (
                                            <div key={item.category} className={styles.row}>
                                                <CategoryTile category={item.category} />
                                                <div className={styles.rowBody}>
                                                    <div className={styles.rowHead}>
                                                        <span className={styles.rowName}>{item.label}</span>
                                                        <span className={styles.rowAmount}>{formatCurrency(item.amount)}</span>
                                                    </div>
                                                    <div className={styles.bar}>
                                                        <motion.span
                                                            className={styles.barFill}
                                                            style={{ background: item.color }}
                                                            initial={{ width: 0 }}
                                                            animate={{ width: `${Math.max(item.percentage, 2)}%` }}
                                                            transition={barSpring}
                                                        />
                                                    </div>
                                                </div>
                                                <span className={styles.rowPct}>{item.percentage}%</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ) : (
                                <EmptyState
                                    compact
                                    icon={<ReceiptText size={22} />}
                                    title={`Nothing yet in ${monthName(analytics.currentMonth)}`}
                                    description="Categories fill in as this month’s expenses come in."
                                />
                            )}
                        </Section>
                    </StaggerItem>

                    {/* ── Who paid ── */}
                    {members.length > 0 && (
                        <StaggerItem>
                            <Section title="Who paid" subtitle="Money fronted this month">
                                <div className={cn(styles.card, styles.list)}>
                                    {members.map((member, index) => (
                                        <div key={`${member.name}-${index}`} className={styles.row}>
                                            <Avatar name={member.name} image={member.image} size="sm" />
                                            <div className={styles.rowBody}>
                                                <div className={styles.rowHead}>
                                                    <span className={styles.rowName}>
                                                        {member.name}
                                                        {index === 0 && members.length > 1 && (
                                                            <Crown size={13} className={styles.crown} aria-label="Top payer" />
                                                        )}
                                                    </span>
                                                    <span className={styles.rowAmount}>{formatCurrency(member.amount)}</span>
                                                </div>
                                                <div className={styles.bar}>
                                                    <motion.span
                                                        className={cn(styles.barFill, styles.barAccent)}
                                                        initial={{ width: 0 }}
                                                        animate={{ width: `${topPaid ? Math.max((member.amount / topPaid) * 100, 3) : 0}%` }}
                                                        transition={barSpring}
                                                    />
                                                </div>
                                            </div>
                                            <span className={styles.rowPct}>
                                                {paidTotal ? Math.round((member.amount / paidTotal) * 100) : 0}%
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </Section>
                        </StaggerItem>
                    )}

                    {/* ── Insights ── */}
                    {analytics.insights.length > 0 && (
                        <StaggerItem>
                            <Section title="Insights">
                                <div className={styles.insights}>
                                    {analytics.insights.map((insight, index) => (
                                        <Notice
                                            key={`${insight.type}-${index}`}
                                            tone={insight.severity}
                                            icon={<InsightIcon severity={insight.severity} />}
                                        >
                                            {insight.message}
                                        </Notice>
                                    ))}
                                </div>
                            </Section>
                        </StaggerItem>
                    )}
                </>
            )}
        </Stagger>
    );
}
