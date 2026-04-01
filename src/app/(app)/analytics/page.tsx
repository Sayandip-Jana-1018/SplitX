'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, Inbox, Loader2, TrendingUp, Users, ArrowRight } from 'lucide-react';
import dynamic from 'next/dynamic';
import ErrorState from '@/components/ui/ErrorState';
import { formatCurrency } from '@/lib/utils';

const SpendingPieChart = dynamic(
    () => import('@/components/charts/SpendingCharts').then((mod) => mod.SpendingPieChart),
    { ssr: false }
);
const DailySpendingChart = dynamic(
    () => import('@/components/charts/SpendingCharts').then((mod) => mod.DailySpendingChart),
    { ssr: false }
);
const GroupSpendBarChart = dynamic(
    () => import('@/components/charts/SpendingCharts').then((mod) => mod.GroupSpendBarChart),
    { ssr: false }
);

const glass: React.CSSProperties = {
    background: 'var(--bg-glass)',
    backdropFilter: 'blur(24px) saturate(1.5)',
    WebkitBackdropFilter: 'blur(24px) saturate(1.5)',
    border: '1px solid var(--border-glass)',
    borderRadius: 'var(--radius-xl)',
    boxShadow: 'var(--shadow-card)',
    position: 'relative',
    overflow: 'hidden',
};

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

const fallbackColors = ['#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899'];

export default function AnalyticsPage() {
    const [payload, setPayload] = useState<AnalyticsPayload | null>(null);
    const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [pickerLoading, setPickerLoading] = useState(false);
    const [error, setError] = useState(false);

    const fetchData = useCallback(async (groupId?: string | null) => {
        const isInitial = !payload;
        setError(false);
        if (isInitial) setLoading(true);
        else setPickerLoading(true);

        try {
            const search = groupId ? `?groupId=${encodeURIComponent(groupId)}` : '';
            const res = await fetch(`/api/analytics${search}`);
            if (!res.ok) {
                setError(true);
                return;
            }
            const nextPayload: AnalyticsPayload = await res.json();
            setPayload(nextPayload);
            setSelectedGroupId(nextPayload.selectedGroupId);
        } catch {
            setError(true);
        } finally {
            setLoading(false);
            setPickerLoading(false);
        }
    }, [payload]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const selectedGroup = useMemo(
        () => payload?.groups.find((group) => group.id === selectedGroupId) || null,
        [payload, selectedGroupId]
    );

    const categoryChartData = useMemo(() => {
        if (!payload) return [];
        return payload.data.categoryBreakdown.map((item, index) => ({
            name: item.label,
            value: item.amount,
            color: fallbackColors[index % fallbackColors.length],
        }));
    }, [payload]);

    const monthlyChartData = useMemo(() => {
        if (!payload) return [];
        return payload.data.monthlyTrend.map((item) => {
            const [year, month] = item.month.split('-');
            return {
                day: new Date(Number(year), Number(month) - 1, 1).toLocaleDateString('en-IN', { month: 'short' }),
                amount: item.total,
            };
        });
    }, [payload]);

    const previousMonthTotal = payload?.data.monthlyTrend.at(-2)?.total || 0;
    const totalThisMonth = payload?.data.totalThisMonth || 0;
    const monthlyDelta = previousMonthTotal
        ? Math.round(((totalThisMonth - previousMonthTotal) / previousMonthTotal) * 100)
        : null;

    const hasMultipleGroups = (payload?.groups.length || 0) > 1;
    const hasData = Boolean(payload && payload.data.monthlyTrend.length > 0);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }} suppressHydrationWarning>
            <div className="page-hero" style={{ paddingTop: 'var(--space-2)' }}>
                <div className="page-kicker">Group Analytics</div>
                <h2 className="page-hero-title">See how one group is spending, clearly</h2>
                <p className="page-hero-subtitle" suppressHydrationWarning>
                    Pick a group, then explore its real monthly trend, category mix, and who has paid the most so far without cross-group overlap.
                </p>
            </div>

            {loading ? (
                <div style={{
                    ...glass, borderRadius: 'var(--radius-2xl)',
                    padding: 'var(--space-10)', display: 'flex', justifyContent: 'center',
                }}>
                    <Loader2 size={28} style={{ animation: 'spin 1s linear infinite', color: 'var(--accent-400)' }} />
                </div>
            ) : error ? (
                <ErrorState onRetry={() => fetchData(selectedGroupId)} variant="network" />
            ) : !payload || payload.groups.length === 0 ? (
                <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}>
                    <div style={{
                        ...glass, borderRadius: 'var(--radius-2xl)',
                        padding: 'var(--space-10) var(--space-4)', textAlign: 'center',
                        background: 'linear-gradient(135deg, rgba(var(--accent-500-rgb), 0.04), var(--bg-glass))',
                    }}>
                        <div style={{
                            width: 56, height: 56, borderRadius: 'var(--radius-2xl)',
                            background: 'rgba(var(--accent-500-rgb), 0.08)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            margin: '0 auto var(--space-3)', color: 'var(--accent-400)',
                        }}>
                            <Inbox size={26} />
                        </div>
                        <div style={{ fontWeight: 600, color: 'var(--fg-primary)', marginBottom: 4 }}>No groups yet</div>
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)' }}>
                            Create a group and add a few expenses to unlock analytics.
                        </div>
                    </div>
                </motion.div>
            ) : (
                <>
                    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
                        <div style={{
                            ...glass,
                            padding: 'var(--space-4)',
                            borderRadius: 'var(--radius-2xl)',
                            background: 'linear-gradient(135deg, rgba(var(--accent-500-rgb), 0.08), var(--bg-glass), rgba(var(--accent-500-rgb), 0.03))',
                        }}>
                            <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: 'var(--space-3)',
                                marginBottom: hasMultipleGroups ? 'var(--space-3)' : 0,
                            }}>
                                <div style={{ textAlign: 'center', flex: 1 }}>
                                    <div style={{
                                        fontSize: 'var(--text-xs)',
                                        color: 'var(--fg-tertiary)',
                                        fontWeight: 700,
                                        textTransform: 'uppercase',
                                        letterSpacing: '0.08em',
                                        marginBottom: 6,
                                    }}>
                                        Selected Group
                                    </div>
                                    <div className="font-display" style={{
                                        fontSize: 'var(--text-xl)',
                                        fontWeight: 800,
                                        color: 'var(--fg-primary)',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        gap: 10,
                                    }}>
                                        <span>{payload.data.groupEmoji || selectedGroup?.emoji || '✨'}</span>
                                        <span>{payload.data.groupName || selectedGroup?.name || 'Your Group'}</span>
                                    </div>
                                </div>
                                {pickerLoading && <Loader2 size={18} style={{ animation: 'spin 1s linear infinite', color: 'var(--accent-400)' }} />}
                            </div>

                            {hasMultipleGroups && (
                                <div style={{
                                    display: 'grid',
                                    gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                                    gap: 'var(--space-3)',
                                }}>
                                    {payload.groups.map((group) => {
                                        const isActive = group.id === selectedGroupId;
                                        return (
                                            <button
                                                key={group.id}
                                                onClick={() => {
                                                    if (group.id !== selectedGroupId) {
                                                        setSelectedGroupId(group.id);
                                                        fetchData(group.id);
                                                    }
                                                }}
                                                style={{
                                                    textAlign: 'left',
                                                    padding: '14px 16px',
                                                    borderRadius: 'var(--radius-xl)',
                                                    border: isActive
                                                        ? '1px solid rgba(var(--accent-500-rgb), 0.24)'
                                                        : '1px solid rgba(var(--accent-500-rgb), 0.08)',
                                                    background: isActive
                                                        ? 'linear-gradient(135deg, rgba(var(--accent-500-rgb), 0.14), rgba(var(--accent-500-rgb), 0.05))'
                                                        : 'rgba(var(--accent-500-rgb), 0.04)',
                                                    cursor: pickerLoading ? 'wait' : 'pointer',
                                                    boxShadow: isActive ? '0 12px 28px rgba(var(--accent-500-rgb), 0.12)' : 'none',
                                                    transition: 'all 0.2s ease',
                                                }}
                                                disabled={pickerLoading}
                                            >
                                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                                                    <div style={{ minWidth: 0 }}>
                                                        <div className="font-display" style={{
                                                            fontSize: 'var(--text-base)',
                                                            fontWeight: 700,
                                                            color: 'var(--fg-primary)',
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: 8,
                                                        }}>
                                                            <span>{group.emoji}</span>
                                                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                                {group.name}
                                                            </span>
                                                        </div>
                                                        <div style={{
                                                            marginTop: 6,
                                                            fontSize: 'var(--text-xs)',
                                                            color: 'var(--fg-tertiary)',
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: 6,
                                                        }}>
                                                            <Users size={12} />
                                                            {group.memberCount} members
                                                        </div>
                                                    </div>
                                                    <ArrowRight size={14} style={{ color: isActive ? 'var(--accent-500)' : 'var(--fg-muted)' }} />
                                                </div>
                                                <div style={{
                                                    marginTop: 10,
                                                    fontSize: 'var(--text-xs)',
                                                    color: 'var(--fg-secondary)',
                                                    fontWeight: 600,
                                                }}>
                                                    Total logged: {formatCurrency(group.totalSpent)}
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </motion.div>

                    {!hasData ? (
                        <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}>
                            <div style={{
                                ...glass,
                                borderRadius: 'var(--radius-2xl)',
                                padding: 'var(--space-10) var(--space-4)',
                                textAlign: 'center',
                            }}>
                                <div style={{
                                    width: 56, height: 56, borderRadius: 'var(--radius-2xl)',
                                    background: 'rgba(var(--accent-500-rgb), 0.08)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    margin: '0 auto var(--space-3)', color: 'var(--accent-400)',
                                }}>
                                    <Inbox size={26} />
                                </div>
                                <div style={{ fontWeight: 600, color: 'var(--fg-primary)', marginBottom: 4 }}>
                                    No analytics for {payload.data.groupName || 'this group'} yet
                                </div>
                                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)' }}>
                                    Add a few expenses in this group and the charts will appear here.
                                </div>
                            </div>
                        </motion.div>
                    ) : (
                        <>
                            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.08 }}>
                                <div style={{
                                    ...glass, borderRadius: 'var(--radius-2xl)', padding: 'var(--space-4)',
                                    background: 'linear-gradient(135deg, rgba(var(--accent-500-rgb), 0.1), var(--bg-glass), rgba(var(--accent-500-rgb), 0.05))',
                                    boxShadow: 'var(--shadow-card), 0 0 30px rgba(var(--accent-500-rgb), 0.06)',
                                    textAlign: 'center',
                                }}>
                                    <div style={{
                                        display: 'grid',
                                        gridTemplateColumns: 'repeat(3, 1fr)',
                                        gap: 'var(--space-3)',
                                        marginBottom: 'var(--space-4)',
                                    }}>
                                        <div>
                                            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                                                This Month
                                            </div>
                                            <div className="font-display" style={{
                                                marginTop: 6,
                                                fontSize: 'var(--text-2xl)',
                                                fontWeight: 800,
                                                background: 'linear-gradient(135deg, var(--accent-400), var(--accent-500))',
                                                WebkitBackgroundClip: 'text',
                                                WebkitTextFillColor: 'transparent',
                                                backgroundClip: 'text',
                                            }}>
                                                {formatCurrency(totalThisMonth)}
                                            </div>
                                        </div>
                                        <div>
                                            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                                                Expenses
                                            </div>
                                            <div className="font-display" style={{ marginTop: 6, fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--fg-primary)' }}>
                                                {payload.data.transactionCount}
                                            </div>
                                        </div>
                                        <div>
                                            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                                                Members
                                            </div>
                                            <div className="font-display" style={{ marginTop: 6, fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--fg-primary)' }}>
                                                {payload.data.memberCount}
                                            </div>
                                        </div>
                                    </div>
                                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-secondary)' }}>
                                        {monthlyDelta === null
                                            ? `Tracking started in ${payload.data.currentMonth}`
                                            : monthlyDelta >= 0
                                                ? `${monthlyDelta}% higher than last month`
                                                : `${Math.abs(monthlyDelta)}% lower than last month`}
                                    </div>
                                </div>
                            </motion.div>

                            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }}>
                                <DailySpendingChart
                                    data={monthlyChartData}
                                    title="Monthly Trend"
                                    emoji={payload.data.groupEmoji || '📈'}
                                />
                            </motion.div>

                            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.16 }}>
                                <GroupSpendBarChart
                                    data={payload.data.memberSpending}
                                    title="Who paid in this group"
                                    subtitle={`Real totals for ${payload.data.groupName || 'this group'} this month`}
                                />
                            </motion.div>

                            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
                                <SpendingPieChart data={categoryChartData} />
                            </motion.div>

                            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.24 }}>
                                <div style={{ ...glass, padding: 'var(--space-4)' }}>
                                    <div className="section-heading" style={{
                                        fontSize: 'var(--text-lg)', fontWeight: 700, color: 'var(--fg-primary)',
                                        marginBottom: 'var(--space-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                                    }}>
                                        <TrendingUp size={16} />
                                        Smart Insights
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                                        {payload.data.insights.length > 0 ? payload.data.insights.map((insight, index) => (
                                            <div
                                                key={`${insight.type}-${index}`}
                                                style={{
                                                    padding: '12px 14px',
                                                    borderRadius: 'var(--radius-lg)',
                                                    background: insight.severity === 'warning'
                                                        ? 'rgba(245, 158, 11, 0.08)'
                                                        : insight.severity === 'success'
                                                            ? 'rgba(34, 197, 94, 0.08)'
                                                            : 'rgba(var(--accent-500-rgb), 0.08)',
                                                    border: insight.severity === 'warning'
                                                        ? '1px solid rgba(245, 158, 11, 0.16)'
                                                        : insight.severity === 'success'
                                                            ? '1px solid rgba(34, 197, 94, 0.16)'
                                                            : '1px solid rgba(var(--accent-500-rgb), 0.12)',
                                                    display: 'flex',
                                                    flexDirection: 'column',
                                                    alignItems: 'center',
                                                    textAlign: 'center',
                                                    gap: 10,
                                                }}
                                            >
                                                {insight.severity === 'warning' ? (
                                                    <AlertTriangle size={16} style={{ color: '#f59e0b', flexShrink: 0, marginTop: 1 }} />
                                                ) : insight.severity === 'success' ? (
                                                    <CheckCircle2 size={16} style={{ color: '#22c55e', flexShrink: 0, marginTop: 1 }} />
                                                ) : (
                                                    <TrendingUp size={16} style={{ color: 'var(--accent-500)', flexShrink: 0, marginTop: 1 }} />
                                                )}
                                                <span style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-secondary)', lineHeight: 1.5 }}>
                                                    {insight.message}
                                                </span>
                                            </div>
                                        )) : (
                                            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-tertiary)', textAlign: 'center' }}>
                                                No notable insights yet. Add more group expenses to make the story clearer.
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </motion.div>
                        </>
                    )}
                </>
            )}
        </div>
    );
}
