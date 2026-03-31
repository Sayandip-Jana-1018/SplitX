'use client';

import type { CSSProperties } from 'react';
import { useEffect } from 'react';
import { useParams } from 'next/navigation';
import useSWR from 'swr';
import { formatCurrency, formatDate } from '@/lib/utils';

const fetcher = async (url: string) => {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error('Failed to load print report');
    }
    return response.json();
};

export default function GroupJourneyPrintPage() {
    const params = useParams();
    const groupId = params.groupId as string;
    const { data } = useSWR(`/api/groups/${groupId}/balance-history?limit=200`, fetcher);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            window.print();
        }, 500);

        return () => window.clearTimeout(timer);
    }, []);

    if (!data) {
        return <div style={{ padding: 24 }}>Preparing report…</div>;
    }

    return (
        <div style={{ padding: 24, maxWidth: 920, margin: '0 auto', color: '#111827', background: '#fff' }}>
            <style jsx global>{`
                @media print {
                    body {
                        background: #fff !important;
                    }
                }
            `}</style>

            <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 32, marginBottom: 4 }}>{data.group.emoji}</div>
                <h1 style={{ margin: 0, fontSize: 28 }}>Balance Journey Report</h1>
                <p style={{ margin: '8px 0 0', color: '#4b5563' }}>
                    {data.group.name} • {data.user.name}
                </p>
                <p style={{ margin: '4px 0 0', color: '#6b7280', fontSize: 14 }}>
                    Exported on {new Date().toLocaleString('en-IN')}
                </p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 24 }}>
                <SummaryBox label="Current balance" value={`${data.currentBalance >= 0 ? '+' : '-'}${formatCurrency(Math.abs(data.currentBalance))}`} />
                <SummaryBox label="Current route" value={data.currentRouteSummary} />
                <SummaryBox label="Changes this week" value={String(data.changeCountThisWeek)} />
            </div>

            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                    <tr style={{ background: '#f3f4f6' }}>
                        <th style={cellStyle}>Date</th>
                        <th style={cellStyle}>Type</th>
                        <th style={cellStyle}>Label</th>
                        <th style={cellStyle}>Before</th>
                        <th style={cellStyle}>Delta</th>
                        <th style={cellStyle}>After</th>
                        <th style={cellStyle}>Explanation</th>
                    </tr>
                </thead>
                <tbody>
                    {data.entries.map((entry: {
                        id: string;
                        createdAt: string;
                        eventType: string;
                        sourceLabel: string;
                        beforeBalance: number;
                        delta: number;
                        afterBalance: number;
                        explanation: string;
                    }) => (
                        <tr key={entry.id}>
                            <td style={cellStyle}>{formatDate(entry.createdAt)}</td>
                            <td style={cellStyle}>{entry.eventType}</td>
                            <td style={cellStyle}>{entry.sourceLabel}</td>
                            <td style={cellStyle}>{formatCurrency(entry.beforeBalance)}</td>
                            <td style={cellStyle}>{entry.delta >= 0 ? '+' : '-'}{formatCurrency(Math.abs(entry.delta))}</td>
                            <td style={cellStyle}>{formatCurrency(entry.afterBalance)}</td>
                            <td style={{ ...cellStyle, lineHeight: 1.5 }}>{entry.explanation}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function SummaryBox({ label, value }: { label: string; value: string }) {
    return (
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 14 }}>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#6b7280', fontWeight: 700, marginBottom: 6 }}>
                {label}
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#111827', lineHeight: 1.5 }}>
                {value}
            </div>
        </div>
    );
}

const cellStyle: CSSProperties = {
    border: '1px solid #e5e7eb',
    textAlign: 'left',
    verticalAlign: 'top',
    padding: '10px 12px',
};
