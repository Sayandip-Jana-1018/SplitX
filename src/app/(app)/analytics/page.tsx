'use client';

import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, Inbox, Loader2, TrendingUp } from 'lucide-react';
import dynamic from 'next/dynamic';
import ErrorState from '@/components/ui/ErrorState';
import { formatCurrency } from '@/lib/utils';
import { isFeatureEnabled } from '@/lib/featureFlags';

const SpendingPieChart = dynamic(
    () => import('@/components/charts/SpendingCharts').then((mod) => mod.SpendingPieChart),
    { ssr: false }
);
const DailySpendingChart = dynamic(
    () => import('@/components/charts/SpendingCharts').then((mod) => mod.DailySpendingChart),
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

interface AnalyticsPayload {
    data: {
        monthlyTrend: { month: string; total: number }[];
        categoryBreakdown: { category: string; label: string; amount: number; percentage: number }[];
        budgetComparison: { category: string; label: string; budget: number; actual: number; overBudget: boolean }[];
        insights: { type: string; message: string; severity: 'info' | 'warning' | 'success' }[];
        currentMonth: string;
        totalThisMonth: number;
    };
}

const fallbackColors = ['#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899'];

export default function AnalyticsPage() {
    const [analytics, setAnalytics] = useState<AnalyticsPayload['data'] | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);

    const fetchData = async () => {
        setError(false);
        setLoading(true);
        try {
            const endpoint = isFeatureEnabled('analyticsUiV2') ? '/api/analytics' : '/api/analytics';
            const res = await fetch(endpoint);
            if (!res.ok) {
                setError(true);
                return;
            }
            const payload: AnalyticsPayload = await res.json();
            setAnalytics(payload.data);
        } catch {
            setError(true);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, []);

    const categoryChartData = useMemo(() => {
        if (!analytics) return [];
        return analytics.categoryBreakdown.map((item, index) => ({
            name: item.label,
            value: item.amount,
            color: fallbackColors[index % fallbackColors.length],
        }));
    }, [analytics]);

    const monthlyChartData = useMemo(() => {
        if (!analytics) return [];
        return analytics.monthlyTrend.map((item) => {
            const [year, month] = item.month.split('-');
            const label = new Date(Number(year), Number(month) - 1, 1).toLocaleDateString('en-IN', { month: 'short' });
            return { day: label, amount: item.total };
        });
    }, [analytics]);

    const previousMonthTotal = analytics?.monthlyTrend.at(-2)?.total || 0;
    const totalThisMonth = analytics?.totalThisMonth || 0;
    const monthlyDelta = previousMonthTotal
        ? Math.round(((totalThisMonth - previousMonthTotal) / previousMonthTotal) * 100)
        : null;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }} suppressHydrationWarning>
            <div className="page-hero" style={{ paddingTop: 'var(--space-2)' }}>
                <div className="page-kicker">Insight Studio</div>
                <h2 className="page-hero-title">See the story behind every rupee</h2>
                <p className="page-hero-subtitle" suppressHydrationWarning>
                    Trends, budgets, and trust-building insights now come straight from your analytics API so the page stays fast and consistent.
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
                <ErrorState onRetry={fetchData} variant="network" />
            ) : !analytics || analytics.monthlyTrend.length === 0 ? (
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
                        <div style={{ fontWeight: 600, color: 'var(--fg-primary)', marginBottom: 4 }}>No analytics yet</div>
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)' }}>Add expenses this month to unlock trends and insights.</div>
                    </div>
                </motion.div>
            ) : (
                <>
                    <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.05 }}>
                        <div style={{
                            ...glass, borderRadius: 'var(--radius-2xl)', padding: 'var(--space-4)',
                            background: 'linear-gradient(135deg, rgba(var(--accent-500-rgb), 0.1), var(--bg-glass), rgba(var(--accent-500-rgb), 0.05))',
                            boxShadow: 'var(--shadow-card), 0 0 30px rgba(var(--accent-500-rgb), 0.06)',
                            textAlign: 'center',
                        }}>
                            <div style={{
                                fontSize: 'var(--text-xs)',
                                color: 'var(--fg-tertiary)',
                                fontWeight: 700,
                                marginBottom: 4,
                                textTransform: 'uppercase',
                                letterSpacing: '0.08em',
                            }}>
                                This Month
                            </div>
                            <div className="font-display" style={{
                                fontSize: 'var(--text-3xl)', fontWeight: 800,
                                background: 'linear-gradient(135deg, var(--accent-400), var(--accent-500))',
                                WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
                            }}>
                                {formatCurrency(totalThisMonth)}
                            </div>
                            <div style={{ marginTop: 8, fontSize: 'var(--text-xs)', color: 'var(--fg-secondary)' }}>
                                {monthlyDelta === null
                                    ? `Tracking started in ${analytics.currentMonth}`
                                    : monthlyDelta >= 0
                                        ? `${monthlyDelta}% higher than last month`
                                        : `${Math.abs(monthlyDelta)}% lower than last month`}
                            </div>
                        </div>
                    </motion.div>

                    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
                        <DailySpendingChart
                            data={monthlyChartData}
                            title="Monthly Trend"
                            emoji="📆"
                        />
                    </motion.div>

                    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
                        <SpendingPieChart data={categoryChartData} />
                    </motion.div>

                    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
                        <div style={{ ...glass, padding: 'var(--space-4)' }}>
                            <div className="section-heading" style={{
                                fontSize: 'var(--text-lg)', fontWeight: 700, color: 'var(--fg-primary)',
                                marginBottom: 'var(--space-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                            }}>
                                <TrendingUp size={16} />
                                Smart Insights
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                                {analytics.insights.length > 0 ? analytics.insights.map((insight, index) => (
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
                                    <div style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-tertiary)' }}>
                                        No notable insights yet. Keep adding expenses and budgets for better signals.
                                    </div>
                                )}
                            </div>
                        </div>
                    </motion.div>

                    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}>
                        <div style={{ ...glass, padding: 'var(--space-4)' }}>
                            <div className="section-heading" style={{
                                fontSize: 'var(--text-lg)', fontWeight: 700, color: 'var(--fg-primary)',
                                marginBottom: 'var(--space-3)',
                                textAlign: 'center',
                            }}>
                                Budget Comparison
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                                {analytics.budgetComparison.length > 0 ? analytics.budgetComparison.map((budget) => {
                                    const ratio = budget.budget > 0 ? Math.min((budget.actual / budget.budget) * 100, 100) : 0;
                                    return (
                                        <div key={budget.category} style={{
                                            padding: '12px 14px',
                                            borderRadius: 'var(--radius-lg)',
                                            background: 'rgba(var(--accent-500-rgb), 0.04)',
                                            border: '1px solid rgba(var(--accent-500-rgb), 0.08)',
                                        }}>
                                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
                                                <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--fg-primary)' }}>
                                                    {budget.label}
                                                </div>
                                                <div style={{
                                                    fontSize: 'var(--text-xs)',
                                                    color: budget.overBudget ? 'var(--color-error)' : 'var(--color-success)',
                                                    fontWeight: 700,
                                                }}>
                                                    {formatCurrency(budget.actual)} / {formatCurrency(budget.budget)}
                                                </div>
                                            </div>
                                            <div style={{
                                                height: 8,
                                                borderRadius: 999,
                                                overflow: 'hidden',
                                                background: 'rgba(var(--accent-500-rgb), 0.08)',
                                            }}>
                                                <div style={{
                                                    height: '100%',
                                                    width: `${ratio}%`,
                                                    borderRadius: 999,
                                                    background: budget.overBudget
                                                        ? 'linear-gradient(90deg, #ef4444, #f97316)'
                                                        : 'linear-gradient(90deg, var(--accent-500), var(--accent-600))',
                                                }} />
                                            </div>
                                        </div>
                                    );
                                }) : (
                                    <div style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-tertiary)' }}>
                                        No budgets set for this month yet.
                                    </div>
                                )}
                            </div>
                        </div>
                    </motion.div>
                </>
            )}
        </div>
    );
}
