'use client';

import { useId } from 'react';
import { Bar, BarChart, Cell, LabelList, Pie, PieChart, ResponsiveContainer, XAxis } from 'recharts';
import styles from './charts.module.css';

export interface TrendPoint {
    label: string;
    /** paise */
    amount: number;
    current?: boolean;
}

export interface DonutSlice {
    key: string;
    label: string;
    /** paise */
    value: number;
    color: string;
}

function trimDecimal(value: number) {
    return value >= 100 ? Math.round(value).toString() : value.toFixed(1).replace(/\.0$/, '');
}

/** Compact rupees from paise — ₹840, ₹12.4k, ₹1.2L, ₹3Cr. */
export function formatCompactRupees(paise: number) {
    const rupees = Math.abs(paise) / 100;
    const sign = paise < 0 ? '−' : '';
    if (rupees >= 1_00_00_000) return `${sign}₹${trimDecimal(rupees / 1_00_00_000)}Cr`;
    if (rupees >= 1_00_000) return `${sign}₹${trimDecimal(rupees / 1_00_000)}L`;
    if (rupees >= 1_000) return `${sign}₹${trimDecimal(rupees / 1_000)}k`;
    return `${sign}₹${Math.round(rupees)}`;
}

/** Month-over-month bars; the current month glows in the accent gradient. */
export function MonthlyTrendChart({ data, height = 210 }: { data: TrendPoint[]; height?: number }) {
    const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
    const currentId = `trend-current-${uid}`;
    const pastId = `trend-past-${uid}`;

    return (
        <div className={styles.chart} style={{ height }}>
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                <BarChart data={data} margin={{ top: 26, right: 0, bottom: 0, left: 0 }} barCategoryGap="24%">
                    <defs>
                        <linearGradient id={currentId} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" style={{ stopColor: 'var(--accent-400)' }} />
                            <stop offset="100%" style={{ stopColor: 'var(--accent-600)' }} />
                        </linearGradient>
                        <linearGradient id={pastId} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" style={{ stopColor: 'var(--accent-500)', stopOpacity: 0.34 }} />
                            <stop offset="100%" style={{ stopColor: 'var(--accent-500)', stopOpacity: 0.12 }} />
                        </linearGradient>
                    </defs>
                    <XAxis dataKey="label" axisLine={false} tickLine={false} interval={0} tickMargin={8} />
                    <Bar dataKey="amount" radius={[10, 10, 4, 4]} maxBarSize={42} animationDuration={750}>
                        {data.map((point, index) => (
                            <Cell key={`${point.label}-${index}`} fill={`url(#${point.current ? currentId : pastId})`} />
                        ))}
                        <LabelList
                            dataKey="amount"
                            position="top"
                            offset={8}
                            formatter={(value: unknown) => (Number(value) > 0 ? formatCompactRupees(Number(value)) : '')}
                        />
                    </Bar>
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
}

/** Donut with the total in the middle. */
export function CategoryDonut({
    data,
    total,
    caption,
    size = 196,
}: {
    data: DonutSlice[];
    total: number;
    caption?: string;
    size?: number;
}) {
    return (
        <div className={styles.donut} style={{ width: size, height: size }}>
            <PieChart width={size} height={size}>
                <Pie
                    data={data}
                    dataKey="value"
                    nameKey="label"
                    cx="50%"
                    cy="50%"
                    innerRadius={Math.round(size * 0.36)}
                    outerRadius={Math.round(size / 2) - 2}
                    paddingAngle={data.length > 1 ? 2.5 : 0}
                    cornerRadius={8}
                    startAngle={90}
                    endAngle={-270}
                    stroke="none"
                    animationDuration={800}
                >
                    {data.map((slice) => (
                        <Cell key={slice.key} fill={slice.color} />
                    ))}
                </Pie>
            </PieChart>
            <div className={styles.donutCenter}>
                <span className={styles.donutValue}>{formatCompactRupees(total)}</span>
                {caption && <span className={styles.donutCaption}>{caption}</span>}
            </div>
        </div>
    );
}
