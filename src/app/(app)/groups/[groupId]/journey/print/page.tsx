'use client';

import type { CSSProperties } from 'react';
import { useEffect } from 'react';
import { useParams } from 'next/navigation';
import useSWR from 'swr';
import { formatCurrency, formatDate } from '@/lib/utils';

interface PrintResponse {
    group: { id: string; name: string; emoji: string };
    user: { id: string; name: string };
    currentBalance: number;
    currentRouteSummary: string;
    changeCountThisWeek: number;
    entries: {
        id: string;
        createdAt: string;
        eventType: string;
        sourceLabel: string;
        beforeBalance: number;
        delta: number;
        afterBalance: number;
        explanation: string;
    }[];
}

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
    const { data } = useSWR<PrintResponse>(`/api/groups/${groupId}/balance-history?limit=200`, fetcher);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            window.print();
        }, 700);

        return () => window.clearTimeout(timer);
    }, []);

    if (!data) {
        return (
            <div style={{
                minHeight: '100vh',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily: 'var(--font-display)',
                background: '#fff',
                color: '#111827',
            }}>
                Preparing your Balance Journey report...
            </div>
        );
    }

    return (
        <div style={{ background: '#f8f5f2', minHeight: '100vh', padding: '32px 20px', color: '#111827' }}>
            <style jsx global>{`
                html, body {
                    background: #ffffff !important;
                }

                @media print {
                    html, body {
                        background: #ffffff !important;
                    }
                }
            `}</style>

            <div style={{
                maxWidth: 980,
                margin: '0 auto',
                background: '#ffffff',
                borderRadius: 32,
                border: '1px solid rgba(15, 23, 42, 0.08)',
                boxShadow: '0 30px 80px rgba(15, 23, 42, 0.08)',
                overflow: 'hidden',
            }}>
                <div style={{
                    padding: '44px 40px 28px',
                    textAlign: 'center',
                    background: 'linear-gradient(180deg, rgba(244, 114, 182, 0.06), rgba(255,255,255,0.98) 72%)',
                    borderBottom: '1px solid rgba(15, 23, 42, 0.06)',
                }}>
                    <div style={{ fontSize: 42, lineHeight: 1, marginBottom: 12 }}>
                        {data.group.emoji}
                    </div>
                    <div style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '8px 16px',
                        borderRadius: 999,
                        background: 'rgba(244, 114, 182, 0.08)',
                        border: '1px solid rgba(244, 114, 182, 0.14)',
                        color: '#db2777',
                        fontSize: 11,
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '0.08em',
                        marginBottom: 16,
                    }}>
                        Personal Balance Report
                    </div>
                    <h1 style={{
                        margin: 0,
                        fontFamily: 'var(--font-display)',
                        fontSize: 42,
                        lineHeight: 1.04,
                        letterSpacing: '-0.04em',
                    }}>
                        Balance Journey Report
                    </h1>
                    <p style={{ margin: '14px 0 0', fontSize: 18, color: '#475569', fontFamily: 'var(--font-display)' }}>
                        {data.group.name} • {data.user.name}
                    </p>
                    <p style={{ margin: '6px 0 0', fontSize: 13, color: '#64748b', fontFamily: 'var(--font-display)' }}>
                        Exported on {new Date().toLocaleString('en-IN')}
                    </p>
                </div>

                <div style={{ padding: '28px 40px 40px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 16, marginBottom: 18 }}>
                        <SummaryBox
                            label="Current balance"
                            value={`${data.currentBalance >= 0 ? '+' : '-'}${formatCurrency(Math.abs(data.currentBalance))}`}
                            accent={data.currentBalance >= 0 ? '#16a34a' : '#dc2626'}
                        />
                        <SummaryBox
                            label="Current route"
                            value={data.currentRouteSummary}
                        />
                        <SummaryBox
                            label="Changes this week"
                            value={String(data.changeCountThisWeek)}
                        />
                    </div>

                    <div style={{
                        padding: '20px 22px',
                        borderRadius: 24,
                        background: 'linear-gradient(180deg, rgba(15, 23, 42, 0.03), rgba(15, 23, 42, 0.01))',
                        border: '1px solid rgba(15, 23, 42, 0.07)',
                        marginBottom: 22,
                        textAlign: 'center',
                    }}>
                        <div style={{
                            fontSize: 11,
                            color: '#64748b',
                            fontWeight: 700,
                            textTransform: 'uppercase',
                            letterSpacing: '0.08em',
                            marginBottom: 8,
                        }}>
                            What this report shows
                        </div>
                        <div style={{
                            fontFamily: 'var(--font-display)',
                            fontSize: 18,
                            lineHeight: 1.6,
                            color: '#1e293b',
                            maxWidth: 760,
                            margin: '0 auto',
                        }}>
                            This report tracks only your own balance changes in this group, showing how your number moved before, during, and after each event.
                        </div>
                    </div>

                    <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: 13 }}>
                        <thead>
                            <tr style={{ background: '#f8fafc' }}>
                                <th style={{ ...cellStyle, borderTopLeftRadius: 18 }}>Date</th>
                                <th style={cellStyle}>Type</th>
                                <th style={cellStyle}>Label</th>
                                <th style={cellStyle}>Before</th>
                                <th style={cellStyle}>Delta</th>
                                <th style={cellStyle}>After</th>
                                <th style={{ ...cellStyle, borderTopRightRadius: 18 }}>Explanation</th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.entries.map((entry, index) => (
                                <tr key={entry.id} style={{ background: index % 2 === 0 ? '#ffffff' : '#fcfcfd' }}>
                                    <td style={bodyCellStyle}>{formatDate(entry.createdAt)}</td>
                                    <td style={bodyCellStyle}>{entry.eventType}</td>
                                    <td style={{ ...bodyCellStyle, fontFamily: 'var(--font-display)', fontWeight: 700 }}>
                                        {entry.sourceLabel}
                                    </td>
                                    <td style={bodyCellStyle}>{formatCurrency(entry.beforeBalance)}</td>
                                    <td style={{
                                        ...bodyCellStyle,
                                        color: entry.delta >= 0 ? '#16a34a' : '#dc2626',
                                        fontFamily: 'var(--font-display)',
                                        fontWeight: 700,
                                    }}>
                                        {entry.delta >= 0 ? '+' : '-'}{formatCurrency(Math.abs(entry.delta))}
                                    </td>
                                    <td style={{ ...bodyCellStyle, fontFamily: 'var(--font-display)', fontWeight: 700 }}>
                                        {formatCurrency(entry.afterBalance)}
                                    </td>
                                    <td style={{ ...bodyCellStyle, lineHeight: 1.6 }}>{entry.explanation}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}

function SummaryBox({
    label,
    value,
    accent,
}: {
    label: string;
    value: string;
    accent?: string;
}) {
    return (
        <div style={{
            minHeight: 160,
            padding: '22px 18px',
            borderRadius: 24,
            border: '1px solid rgba(15, 23, 42, 0.08)',
            background: '#ffffff',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-start',
            gap: 10,
        }}>
            <div style={{
                fontSize: 11,
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                color: '#64748b',
                fontWeight: 700,
            }}>
                {label}
            </div>
            <div style={{
                fontFamily: 'var(--font-display)',
                fontSize: 18,
                fontWeight: 800,
                color: accent || '#111827',
                lineHeight: 1.55,
                overflowWrap: 'anywhere',
            }}>
                {value}
            </div>
        </div>
    );
}

const cellStyle: CSSProperties = {
    borderTop: '1px solid rgba(15, 23, 42, 0.08)',
    borderBottom: '1px solid rgba(15, 23, 42, 0.08)',
    borderRight: '1px solid rgba(15, 23, 42, 0.08)',
    padding: '14px 14px',
    textAlign: 'left',
    verticalAlign: 'top',
    fontWeight: 700,
    color: '#334155',
    fontFamily: 'var(--font-display)',
};

const bodyCellStyle: CSSProperties = {
    borderBottom: '1px solid rgba(15, 23, 42, 0.08)',
    borderRight: '1px solid rgba(15, 23, 42, 0.08)',
    padding: '14px 14px',
    textAlign: 'left',
    verticalAlign: 'top',
    color: '#334155',
    fontFamily: 'var(--font-display)',
};
