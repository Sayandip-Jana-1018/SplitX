'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Loader2, Inbox } from 'lucide-react';
import dynamic from 'next/dynamic';

const SpendingPieChart = dynamic(() => import('@/components/charts/SpendingCharts').then(mod => mod.SpendingPieChart), { ssr: false });
const DailySpendingChart = dynamic(() => import('@/components/charts/SpendingCharts').then(mod => mod.DailySpendingChart), { ssr: false });
const MemberSpendChart = dynamic(() => import('@/components/charts/SpendingCharts').then(mod => mod.MemberSpendChart), { ssr: false });
import { CATEGORIES, formatCurrency } from '@/lib/utils';
import ErrorState from '@/components/ui/ErrorState';

/* ── Glassmorphic styles ── */
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

interface Transaction {
    id: string;
    title: string;
    amount: number;
    category: string;
    payerId: string;
    payer: { id: string; name: string | null };
    splits: { userId: string; amount: number; user: { id: string; name: string | null } }[];
    createdAt: string;
}

const CATEGORY_COLORS: Record<string, string> = {
    food: '#ef4444', transport: '#3b82f6', stay: '#8b5cf6', shopping: '#ec4899',
    tickets: '#f59e0b', entertainment: '#06b6d4', general: '#64748b', utilities: '#22c55e',
    groceries: '#f97316', health: '#14b8a6', education: '#a855f7', other: '#78716c',
};

export default function AnalyticsPage() {

    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);

    const fetchData = async () => {
        setError(false); setLoading(true);
        try {
            const res = await fetch('/api/transactions?limit=200');
            if (res.ok) {
                const data = await res.json();
                setTransactions(Array.isArray(data) ? data : []);
            } else setError(true);
        } catch { setError(true); }
        finally { setLoading(false); }
    };

    useEffect(() => { fetchData(); }, []);

    /* ── Computed chart data ── */
    const categoryData = (() => {
        const knownCategories = new Set(Object.keys(CATEGORIES));
        const map: Record<string, number> = {};
        for (const t of transactions) {
            const raw = (t.category || 'other').toLowerCase();
            // Group unknown/custom categories under 'other'
            const c = knownCategories.has(raw) ? raw : 'other';
            map[c] = (map[c] || 0) + t.amount;
        }
        return Object.entries(map).map(([key, value]) => ({
            name: CATEGORIES[key]?.label || key, value, color: CATEGORY_COLORS[key] || '#64748b',
        }));
    })();

    const dailyData = (() => {
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const map: Record<string, number> = {}; for (const d of days) map[d] = 0;
        for (const t of transactions) { map[days[new Date(t.createdAt).getDay()]] += t.amount; }
        return days.map(day => ({ day, amount: map[day] }));
    })();

    const memberData = (() => {
        const paid: Record<string, { name: string; paid: number; spent: number }> = {};
        for (const t of transactions) {
            const pn = t.payer?.name || 'Unknown';
            if (!paid[t.payerId]) paid[t.payerId] = { name: pn, paid: 0, spent: 0 };
            paid[t.payerId].paid += t.amount;
            for (const s of t.splits) {
                const sn = s.user?.name || 'Unknown';
                if (!paid[s.userId]) paid[s.userId] = { name: sn, paid: 0, spent: 0 };
                paid[s.userId].spent += s.amount;
            }
        }
        return Object.values(paid);
    })();

    const totalSpent = transactions.reduce((s, t) => s + t.amount, 0);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }} suppressHydrationWarning>
            {/* ═══ HEADER ═══ */}
            <p style={{ color: 'var(--fg-tertiary)', fontSize: 'var(--text-xs)' }} suppressHydrationWarning>
                Spending breakdown from your transactions
            </p>

            {loading ? (
                <div style={{
                    ...glass, borderRadius: 'var(--radius-2xl)',
                    padding: 'var(--space-10)', display: 'flex', justifyContent: 'center',
                }}>
                    <Loader2 size={28} style={{ animation: 'spin 1s linear infinite', color: 'var(--accent-400)' }} />
                </div>
            ) : error ? (
                <ErrorState onRetry={fetchData} variant="network" />
            ) : transactions.length === 0 ? (
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
                        <div style={{ fontWeight: 600, color: 'var(--fg-primary)', marginBottom: 4 }}>No transactions yet</div>
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)' }}>Add expenses to see your spending analytics</div>
                    </div>
                </motion.div>
            ) : (
                <>
                    {/* ═══ TOTAL SPENT HERO ═══ */}
                    <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.05 }}>
                        <div style={{
                            ...glass, borderRadius: 'var(--radius-2xl)', padding: 'var(--space-4)',
                            background: 'linear-gradient(135deg, rgba(var(--accent-500-rgb), 0.1), var(--bg-glass), rgba(var(--accent-500-rgb), 0.05))',
                            boxShadow: 'var(--shadow-card), 0 0 30px rgba(var(--accent-500-rgb), 0.06)',
                            textAlign: 'center',
                        }}>
                            <div style={{
                                position: 'absolute', top: 0, left: '15%', right: '15%', height: 1,
                                background: 'linear-gradient(90deg, transparent, rgba(var(--accent-500-rgb), 0.15), transparent)',
                                pointerEvents: 'none',
                            }} />
                            <div style={{ position: 'relative', zIndex: 1 }}>
                                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)', fontWeight: 600, marginBottom: 4 }}>
                                    Total Analyzed
                                </div>
                                <div style={{
                                    fontSize: 'var(--text-2xl)', fontWeight: 800,
                                    background: 'linear-gradient(135deg, var(--accent-400), var(--accent-500))',
                                    WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
                                }}>
                                    {formatCurrency(totalSpent)}
                                </div>
                                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-muted)', marginTop: 4 }}>
                                    from {transactions.length} transactions
                                </div>
                            </div>
                        </div>
                    </motion.div>

                    {/* ═══ CATEGORY PIE CHART ═══ */}
                    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
                        <SpendingPieChart data={categoryData} />
                    </motion.div>

                    {/* ═══ DAILY TREND ═══ */}
                    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
                        <DailySpendingChart data={dailyData} />
                    </motion.div>

                    {/* ═══ MEMBER COMPARISON ═══ */}
                    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
                        <MemberSpendChart data={memberData} />
                    </motion.div>
                </>
            )}
        </div>
    );
}
