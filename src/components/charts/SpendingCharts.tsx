'use client';

import {
    PieChart,
    Pie,
    Cell,
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
} from 'recharts';

import { formatCurrency } from '@/lib/utils';

/* ── Glassmorphic card wrapper ── */
const glassCard: React.CSSProperties = {
    background: 'var(--bg-glass)',
    backdropFilter: 'blur(20px) saturate(1.4)',
    WebkitBackdropFilter: 'blur(20px) saturate(1.4)',
    border: '1px solid var(--border-default, rgba(0,0,0,0.06))',
    borderRadius: 'var(--radius-xl)',
    boxShadow: 'var(--shadow-card)',
    padding: 'var(--space-4)',
    position: 'relative' as const,
    overflow: 'hidden' as const,
};

/* ── Vibrant category color palette ── */
const VIBRANT_COLORS = [
    '#f43f5e', // rose
    '#8b5cf6', // violet
    '#06b6d4', // cyan
    '#f59e0b', // amber
    '#10b981', // emerald
    '#3b82f6', // blue
    '#ec4899', // pink
    '#14b8a6', // teal
    '#f97316', // orange
    '#a855f7', // purple
    '#22c55e', // green
    '#e11d48', // crimson
    '#6366f1', // indigo
    '#eab308', // yellow
    '#0ea5e9', // sky
    '#d946ef', // fuchsia
];

// Gradient definitions for bars
const GRADIENT_PAIRS = [
    ['#f43f5e', '#fb7185'],   // rose
    ['#8b5cf6', '#a78bfa'],   // violet
    ['#06b6d4', '#22d3ee'],   // cyan
    ['#f59e0b', '#fbbf24'],   // amber
    ['#10b981', '#34d399'],   // emerald
    ['#3b82f6', '#60a5fa'],   // blue
];

// ── Category Spending Pie Chart ──

interface CategoryData {
    name: string;
    value: number; // paise
    color: string;
}

const MOCK_CATEGORY_DATA: CategoryData[] = [
    { name: 'Food', value: 580000, color: '#f43f5e' },
    { name: 'Transport', value: 320000, color: '#8b5cf6' },
    { name: 'Stay', value: 850000, color: '#06b6d4' },
    { name: 'Shopping', value: 190000, color: '#f59e0b' },
    { name: 'Tickets', value: 120000, color: '#10b981' },
    { name: 'Entertainment', value: 95000, color: '#3b82f6' },
];

export function SpendingPieChart({ data = MOCK_CATEGORY_DATA }: { data?: CategoryData[] }) {
    const total = data.reduce((sum, d) => sum + d.value, 0);
    // Assign vibrant colors if not already colorful
    const coloredData = data.map((d, i) => ({
        ...d,
        color: VIBRANT_COLORS[i % VIBRANT_COLORS.length],
    }));

    return (
        <div style={glassCard}>
            {/* Subtle accent glow */}
            <div style={{
                position: 'absolute', top: -40, right: -40, width: 120, height: 120,
                borderRadius: '50%', background: 'rgba(var(--accent-500-rgb), 0.06)',
                filter: 'blur(40px)', pointerEvents: 'none',
            }} />
            <h4 style={{
                fontSize: 'var(--text-sm)', fontWeight: 700, marginBottom: 'var(--space-3)',
                color: 'var(--fg-primary)', position: 'relative', zIndex: 1,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}>
                <span style={{ fontSize: 16 }}>📊</span>
                Spending by Category
            </h4>
            <div style={{ width: '100%', height: 230, position: 'relative', zIndex: 1 }}>
                <ResponsiveContainer minWidth={0}>
                    <PieChart>
                        <defs>
                            {coloredData.map((entry, i) => (
                                <linearGradient key={`grad-${i}`} id={`pieGrad-${i}`} x1="0" y1="0" x2="1" y2="1">
                                    <stop offset="0%" stopColor={entry.color} stopOpacity={1} />
                                    <stop offset="100%" stopColor={entry.color} stopOpacity={0.7} />
                                </linearGradient>
                            ))}
                        </defs>
                        <Pie
                            data={coloredData}
                            cx="50%"
                            cy="50%"
                            innerRadius={58}
                            outerRadius={90}
                            paddingAngle={3}
                            dataKey="value"
                            animationBegin={0}
                            animationDuration={900}
                            cornerRadius={4}
                        >
                            {coloredData.map((_, i) => (
                                <Cell key={i} fill={`url(#pieGrad-${i})`} stroke="rgba(255,255,255,0.15)" strokeWidth={1} />
                            ))}
                        </Pie>
                        <Tooltip
                            wrapperStyle={{ outline: 'none', border: 'none', background: 'transparent', boxShadow: 'none' }}
                            cursor={false}
                            content={({ payload }) => {
                                if (!payload?.length) return null;
                                const d = payload[0].payload as CategoryData;
                                return (
                                    <div style={{
                                        background: 'var(--surface-card, rgba(255,255,255,0.95))', backdropFilter: 'blur(16px)',
                                        border: '1px solid var(--border-default, rgba(0,0,0,0.08))',
                                        borderRadius: '12px',
                                        padding: '10px 14px', fontSize: 'var(--text-xs)',
                                        boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
                                        color: 'var(--fg-primary)',
                                    }}>
                                        <span style={{ fontWeight: 700, color: d.color }}>{d.name}</span>
                                        <span style={{ color: 'var(--fg-secondary)', marginLeft: 6 }}>{formatCurrency(d.value)}</span>
                                        <span style={{ color: 'var(--fg-tertiary)', marginLeft: 6 }}>
                                            ({Math.round((d.value / total) * 100)}%)
                                        </span>
                                    </div>
                                );
                            }}
                        />
                    </PieChart>
                </ResponsiveContainer>
            </div>
            {/* ── Colorful Legend Grid ── */}
            <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '6px 12px',
                marginTop: 'var(--space-2)', position: 'relative', zIndex: 1,
            }}>
                {coloredData.map((d) => (
                    <div key={d.name} style={{
                        display: 'flex', alignItems: 'center', gap: 6,
                        fontSize: 11, padding: '4px 8px', borderRadius: 'var(--radius-md)',
                        background: `${d.color}08`, border: `1px solid ${d.color}15`,
                    }}>
                        <span style={{
                            width: 10, height: 10, borderRadius: 3, flexShrink: 0,
                            background: `linear-gradient(135deg, ${d.color}, ${d.color}aa)`,
                            boxShadow: `0 0 6px ${d.color}40`,
                        }} />
                        <span style={{ color: 'var(--fg-secondary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
                            {d.name}
                        </span>
                        <span style={{ fontWeight: 700, color: d.color, flexShrink: 0 }}>
                            {Math.round((d.value / total) * 100)}%
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
}

// ── Daily Spending Bar Chart ──

interface DailyData {
    day: string;
    amount: number; // paise
}

const MOCK_DAILY_DATA: DailyData[] = [
    { day: 'Mon', amount: 250000 },
    { day: 'Tue', amount: 180000 },
    { day: 'Wed', amount: 420000 },
    { day: 'Thu', amount: 310000 },
    { day: 'Fri', amount: 150000 },
    { day: 'Sat', amount: 580000 },
    { day: 'Sun', amount: 350000 },
];

export function DailySpendingChart({ data = MOCK_DAILY_DATA }: { data?: DailyData[] }) {
    const maxAmount = Math.max(...data.map(d => d.amount));

    return (
        <div style={glassCard}>
            <div style={{
                position: 'absolute', bottom: -30, left: -30, width: 100, height: 100,
                borderRadius: '50%', background: 'rgba(var(--accent-500-rgb), 0.05)',
                filter: 'blur(30px)', pointerEvents: 'none',
            }} />
            <h4 style={{
                fontSize: 'var(--text-sm)', fontWeight: 700, marginBottom: 'var(--space-3)',
                color: 'var(--fg-primary)', position: 'relative', zIndex: 1,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}>
                <span style={{ fontSize: 16 }}>📈</span>
                Daily Spending
            </h4>
            <div style={{ width: '100%', height: 210, position: 'relative', zIndex: 1 }}>
                <ResponsiveContainer minWidth={0}>
                    <BarChart data={data} barSize={22}>
                        <defs>
                            {GRADIENT_PAIRS.map(([start, end], i) => (
                                <linearGradient key={`barGrad-${i}`} id={`barGrad-${i}`} x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor={start} stopOpacity={0.95} />
                                    <stop offset="100%" stopColor={end} stopOpacity={0.6} />
                                </linearGradient>
                            ))}
                        </defs>
                        <CartesianGrid
                            strokeDasharray="3 3"
                            stroke="var(--border-subtle)"
                            vertical={false}
                            strokeOpacity={0.5}
                        />
                        <XAxis
                            dataKey="day"
                            tick={{ fill: 'var(--fg-tertiary)', fontSize: 11, fontWeight: 500 }}
                            axisLine={false}
                            tickLine={false}
                        />
                        <YAxis
                            tick={{ fill: 'var(--fg-tertiary)', fontSize: 10 }}
                            axisLine={false}
                            tickLine={false}
                            tickFormatter={(v: number) => `₹${(v / 100).toLocaleString('en-IN')}`}
                            width={55}
                        />
                        <Tooltip
                            wrapperStyle={{ outline: 'none', border: 'none', background: 'transparent', boxShadow: 'none' }}
                            cursor={{ fill: 'rgba(var(--accent-500-rgb), 0.06)' }}
                            content={({ payload, label }) => {
                                if (!payload?.length) return null;
                                return (
                                    <div style={{
                                        background: 'var(--surface-card, rgba(255,255,255,0.95))', backdropFilter: 'blur(16px)',
                                        border: '1px solid var(--border-default, rgba(0,0,0,0.08))',
                                        borderRadius: 'var(--radius-lg, 12px)',
                                        padding: '10px 14px', fontSize: 'var(--text-xs)',
                                        boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
                                        color: 'var(--fg-primary)',
                                    }}>
                                        <span style={{ fontWeight: 700 }}>{label}</span>
                                        <span style={{ marginLeft: 6, color: 'var(--fg-secondary)' }}>
                                            {formatCurrency(payload[0].value as number)}
                                        </span>
                                    </div>
                                );
                            }}
                        />
                        <Bar
                            dataKey="amount"
                            radius={[6, 6, 0, 0]}
                            animationBegin={0}
                            animationDuration={700}
                        >
                            {data.map((entry, i) => (
                                <Cell
                                    key={i}
                                    fill={entry.amount === maxAmount ? 'url(#barGrad-0)' : `url(#barGrad-${(i % 5) + 1})`}
                                />
                            ))}
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}

// ── Member Spending Comparison ──

interface MemberSpend {
    name: string;
    paid: number;   // paise
    spent: number;  // paise (fair share / consumption)
}

const MOCK_MEMBER_DATA: MemberSpend[] = [
    { name: 'Sayan', paid: 780000, spent: 520000 },
    { name: 'Aman', paid: 450000, spent: 520000 },
    { name: 'Priya', paid: 650000, spent: 520000 },
    { name: 'Rahul', paid: 200000, spent: 520000 },
];

const MEMBER_PAID_COLORS = ['#f43f5e', '#8b5cf6', '#06b6d4', '#f59e0b', '#10b981', '#3b82f6'];
const MEMBER_OWES_COLORS = ['#fda4af', '#c4b5fd', '#67e8f9', '#fcd34d', '#6ee7b7', '#93c5fd'];

export function MemberSpendChart({ data = MOCK_MEMBER_DATA }: { data?: MemberSpend[] }) {
    return (
        <div style={glassCard}>
            <div style={{
                position: 'absolute', top: -20, left: '50%', width: 160, height: 80,
                transform: 'translateX(-50%)', borderRadius: '50%',
                background: 'rgba(var(--accent-500-rgb), 0.04)',
                filter: 'blur(30px)', pointerEvents: 'none',
            }} />
            <h4 style={{
                fontSize: 'var(--text-sm)', fontWeight: 700, marginBottom: 'var(--space-3)',
                color: 'var(--fg-primary)', position: 'relative', zIndex: 1,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}>
                <span style={{ fontSize: 16 }}>👥</span>
                Who Paid vs Who Spent
            </h4>
            <div style={{ width: '100%', height: Math.max(180, data.length * 50), position: 'relative', zIndex: 1 }}>
                <ResponsiveContainer minWidth={0}>
                    <BarChart data={data} layout="vertical" barSize={12}>
                        <defs>
                            {data.map((_, i) => (
                                <linearGradient key={`mpGrad-${i}`} id={`memberPaidGrad-${i}`} x1="0" y1="0" x2="1" y2="0">
                                    <stop offset="0%" stopColor={MEMBER_PAID_COLORS[i % MEMBER_PAID_COLORS.length]} stopOpacity={0.9} />
                                    <stop offset="100%" stopColor={MEMBER_PAID_COLORS[i % MEMBER_PAID_COLORS.length]} stopOpacity={0.6} />
                                </linearGradient>
                            ))}
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" horizontal={false} strokeOpacity={0.5} />
                        <XAxis
                            type="number"
                            tick={{ fill: 'var(--fg-tertiary)', fontSize: 10 }}
                            axisLine={false}
                            tickLine={false}
                            tickFormatter={(v: number) => `₹${(v / 100).toLocaleString('en-IN')}`}
                        />
                        <YAxis
                            type="category"
                            dataKey="name"
                            tick={{ fill: 'var(--fg-secondary)', fontSize: 11, fontWeight: 500 }}
                            axisLine={false}
                            tickLine={false}
                            width={75}
                        />
                        <Tooltip
                            wrapperStyle={{ outline: 'none', border: 'none', background: 'transparent', boxShadow: 'none' }}
                            cursor={false}
                            content={({ payload, label }) => {
                                if (!payload?.length) return null;
                                return (
                                    <div style={{
                                        background: 'var(--surface-card, rgba(255,255,255,0.95))', backdropFilter: 'blur(16px)',
                                        border: '1px solid var(--border-default, rgba(0,0,0,0.08))',
                                        borderRadius: '12px',
                                        padding: '10px 14px', fontSize: 'var(--text-xs)',
                                        boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
                                        color: 'var(--fg-primary)',
                                    }}>
                                        <div style={{ fontWeight: 700, marginBottom: 4, color: 'var(--fg-primary)' }}>{label}</div>
                                        {payload.map((p: { name: string; value: number; color: string }) => (
                                            <div key={p.name} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                                                <span style={{ width: 6, height: 6, borderRadius: 2, background: p.color }} />
                                                <span>{p.name === 'paid' ? 'Paid' : 'Spent'}:</span>
                                                <span style={{ fontWeight: 600 }}>{formatCurrency(p.value)}</span>
                                            </div>
                                        ))}
                                    </div>
                                );
                            }}
                        />
                        <Bar dataKey="paid" radius={[0, 6, 6, 0]} name="paid" animationDuration={700}>
                            {data.map((_, i) => (
                                <Cell key={i} fill={`url(#memberPaidGrad-${i})`} />
                            ))}
                        </Bar>
                        <Bar dataKey="spent" radius={[0, 6, 6, 0]} name="spent" animationDuration={700}>
                            {data.map((_, i) => (
                                <Cell key={i} fill={MEMBER_OWES_COLORS[i % MEMBER_OWES_COLORS.length]} opacity={0.45} />
                            ))}
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
            </div>
            {/* ── Colorful legend ── */}
            <div style={{
                display: 'flex', gap: 16, marginTop: 'var(--space-2)',
                fontSize: 'var(--text-xs)', justifyContent: 'center', position: 'relative', zIndex: 1,
            }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{
                        width: 12, height: 8, borderRadius: 3,
                        background: 'linear-gradient(90deg, #f43f5e, #8b5cf6)',
                    }} />
                    <span style={{ fontWeight: 600, color: 'var(--fg-secondary)' }}>Paid</span>
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{
                        width: 12, height: 8, borderRadius: 3,
                        background: 'linear-gradient(90deg, #fda4af, #c4b5fd)', opacity: 0.5,
                    }} />
                    <span style={{ fontWeight: 600, color: 'var(--fg-secondary)' }}>Spent</span>
                </span>
            </div>
        </div>
    );
}
