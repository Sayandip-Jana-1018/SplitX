'use client';

import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Image as ImageIcon, X, ChevronLeft, Loader2,
    Calendar, User, Tag, Receipt, ZoomIn,
    Filter, ChevronDown,
} from 'lucide-react';
import Avatar from '@/components/ui/Avatar';

import { formatCurrency, timeAgo } from '@/lib/utils';
import { useParams, useRouter } from 'next/navigation';

/* ── Types ── */
interface ReceiptEntry {
    id: string;
    title: string;
    amount: number;
    category: string;
    receiptUrl: string;
    date: string;
    payer: {
        id: string;
        name: string | null;
        image: string | null;
    };
}

/* ── Category emoji map ── */
const CAT_EMOJI: Record<string, string> = {
    food: '🍔', transport: '🚗', shopping: '🛍️', entertainment: '🎬',
    bills: '📄', health: '💊', education: '📚', general: '📦',
};

export default function ReceiptGalleryPage() {
    const params = useParams();
    const router = useRouter();
    const groupId = params?.groupId as string;

    const [receipts, setReceipts] = useState<ReceiptEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedReceipt, setSelectedReceipt] = useState<ReceiptEntry | null>(null);
    const [filterOpen, setFilterOpen] = useState(false);
    const [filterMember, setFilterMember] = useState<string>('all');
    const [members, setMembers] = useState<{ id: string; name: string; image: string | null }[]>([]);

    const fetchReceipts = useCallback(async () => {
        try {
            const res = await fetch(`/api/groups/${groupId}/receipts`);
            if (res.ok) {
                const data = await res.json();
                setReceipts(data.receipts || []);
                setMembers(data.members || []);
            }
        } catch (e) {
            console.error('Failed to fetch receipts:', e);
        } finally {
            setLoading(false);
        }
    }, [groupId]);

    useEffect(() => { fetchReceipts(); }, [fetchReceipts]);

    const filtered = filterMember === 'all'
        ? receipts
        : receipts.filter(r => r.payer.id === filterMember);

    // Group receipts by date
    const groupedByDate = filtered.reduce<Record<string, ReceiptEntry[]>>((acc, r) => {
        const dateKey = new Date(r.date).toLocaleDateString('en-IN', {
            day: 'numeric', month: 'short', year: 'numeric',
        });
        if (!acc[dateKey]) acc[dateKey] = [];
        acc[dateKey].push(r);
        return acc;
    }, {});

    return (
        <div style={{
            minHeight: '100dvh',
            maxWidth: 520,
            margin: '0 auto',
            padding: '0 16px 100px',
        }}>
            {/* ── Sticky Header ── */}
            <div style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '20px 0 16px',
                position: 'sticky', top: 0, zIndex: 10,
                background: 'var(--bg-primary)',
            }}>
                <button
                    onClick={() => router.back()}
                    style={{
                        width: 36, height: 36, borderRadius: 12,
                        background: 'var(--bg-secondary)',
                        border: '1px solid var(--border-subtle)',
                        cursor: 'pointer', color: 'var(--fg-secondary)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        flexShrink: 0,
                    }}
                >
                    <ChevronLeft size={18} />
                </button>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <h1 style={{
                        margin: 0, fontSize: 'var(--text-lg)', fontWeight: 800,
                        color: 'var(--fg-primary)',
                        display: 'flex', alignItems: 'center', gap: 8,
                        letterSpacing: '-0.02em',
                    }}>
                        <Receipt size={18} style={{ color: 'var(--accent-400)' }} />
                        Receipts
                    </h1>
                    <p style={{
                        margin: '2px 0 0', fontSize: 'var(--text-xs)',
                        color: 'var(--fg-tertiary)', textAlign: 'left',
                    }}>
                        {receipts.length} receipt{receipts.length !== 1 ? 's' : ''} captured
                    </p>
                </div>
                <button
                    onClick={() => setFilterOpen(!filterOpen)}
                    style={{
                        display: 'flex', alignItems: 'center', gap: 4,
                        padding: '7px 12px', borderRadius: 12,
                        background: filterMember === 'all'
                            ? 'var(--bg-secondary)'
                            : 'rgba(var(--accent-500-rgb), 0.1)',
                        border: `1px solid ${filterMember === 'all' ? 'var(--border-subtle)' : 'rgba(var(--accent-500-rgb), 0.2)'}`,
                        cursor: 'pointer',
                        color: filterMember === 'all' ? 'var(--fg-tertiary)' : 'var(--accent-500)',
                        fontSize: 12, fontWeight: 600,
                        transition: 'all 0.2s',
                    }}
                >
                    <Filter size={13} />
                    Filter
                    <ChevronDown size={11} style={{
                        transform: filterOpen ? 'rotate(180deg)' : 'none',
                        transition: 'transform 0.2s',
                    }} />
                </button>
            </div>

            {/* ── Filter Dropdown ── */}
            <AnimatePresence>
                {filterOpen && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        style={{ overflow: 'hidden', marginBottom: 12 }}
                    >
                        <div style={{
                            display: 'flex', flexWrap: 'wrap', gap: 6,
                            background: 'var(--bg-secondary)',
                            border: '1px solid var(--border-subtle)',
                            borderRadius: 16,
                            padding: 12,
                        }}>
                            <button
                                onClick={() => { setFilterMember('all'); setFilterOpen(false); }}
                                style={{
                                    padding: '6px 14px', borderRadius: 20,
                                    border: 'none', cursor: 'pointer',
                                    background: filterMember === 'all'
                                        ? 'rgba(var(--accent-500-rgb), 0.15)'
                                        : 'var(--bg-primary)',
                                    color: filterMember === 'all'
                                        ? 'var(--accent-500)'
                                        : 'var(--fg-tertiary)',
                                    fontSize: 12, fontWeight: 600,
                                    transition: 'all 0.2s',
                                }}
                            >
                                All
                            </button>
                            {members.map(m => (
                                <button
                                    key={m.id}
                                    onClick={() => { setFilterMember(m.id); setFilterOpen(false); }}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: 5,
                                        padding: '4px 12px 4px 4px', borderRadius: 20,
                                        border: 'none', cursor: 'pointer',
                                        background: filterMember === m.id
                                            ? 'rgba(var(--accent-500-rgb), 0.15)'
                                            : 'var(--bg-primary)',
                                        color: filterMember === m.id
                                            ? 'var(--accent-500)'
                                            : 'var(--fg-tertiary)',
                                        fontSize: 12, fontWeight: 600,
                                        transition: 'all 0.2s',
                                    }}
                                >
                                    <Avatar name={m.name} image={m.image} size="xs" />
                                    {m.name?.split(' ')[0]}
                                </button>
                            ))}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* ── Content ── */}
            {loading ? (
                <div style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center',
                    justifyContent: 'center', padding: 80, gap: 14,
                    color: 'var(--fg-tertiary)',
                }}>
                    <Loader2 size={28} className="animate-spin" style={{ color: 'var(--accent-400)' }} />
                    <span style={{ fontSize: 'var(--text-sm)', fontWeight: 500 }}>Loading receipts...</span>
                </div>
            ) : filtered.length === 0 ? (
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    style={{
                        display: 'flex', flexDirection: 'column', alignItems: 'center',
                        justifyContent: 'center', padding: '80px 24px', gap: 16,
                        textAlign: 'center',
                    }}
                >
                    <div style={{
                        width: 72, height: 72, borderRadius: 20,
                        background: 'linear-gradient(135deg, rgba(var(--accent-500-rgb), 0.1), rgba(var(--accent-500-rgb), 0.05))',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        border: '1px solid rgba(var(--accent-500-rgb), 0.1)',
                    }}>
                        <ImageIcon size={32} style={{ color: 'var(--accent-400)' }} />
                    </div>
                    <div>
                        <p style={{
                            fontSize: 'var(--text-base)', fontWeight: 700,
                            color: 'var(--fg-primary)', margin: '0 0 4px',
                        }}>
                            No receipts yet
                        </p>
                        <p style={{
                            fontSize: 'var(--text-sm)', color: 'var(--fg-tertiary)',
                            maxWidth: 280, margin: '0 auto', lineHeight: 1.5,
                        }}>
                            Scan receipts when adding expenses to build your group&apos;s receipt gallery
                        </p>
                    </div>
                </motion.div>
            ) : (
                /* ── Receipts grouped by date ── */
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                    {Object.entries(groupedByDate).map(([dateLabel, dateReceipts]) => (
                        <div key={dateLabel}>
                            {/* Date header */}
                            <div style={{
                                display: 'flex', alignItems: 'center', gap: 8,
                                marginBottom: 10, padding: '0 2px',
                            }}>
                                <Calendar size={13} style={{ color: 'var(--fg-muted)' }} />
                                <span style={{
                                    fontSize: 12, fontWeight: 700, color: 'var(--fg-tertiary)',
                                    letterSpacing: '0.02em', textTransform: 'uppercase',
                                }}>
                                    {dateLabel}
                                </span>
                                <div style={{
                                    flex: 1, height: 1,
                                    background: 'var(--border-subtle)',
                                }} />
                            </div>

                            {/* Receipt cards for this date */}
                            <div style={{
                                display: 'flex', flexDirection: 'column', gap: 10,
                            }}>
                                {dateReceipts.map((receipt, idx) => (
                                    <motion.div
                                        key={receipt.id}
                                        initial={{ opacity: 0, y: 12 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ delay: idx * 0.03, duration: 0.25 }}
                                        onClick={() => setSelectedReceipt(receipt)}
                                        whileTap={{ scale: 0.98 }}
                                        style={{
                                            display: 'flex', gap: 12,
                                            padding: 10,
                                            borderRadius: 16,
                                            background: 'var(--bg-secondary)',
                                            border: '1px solid var(--border-subtle)',
                                            cursor: 'pointer',
                                            transition: 'all 0.2s ease',
                                            alignItems: 'center',
                                        }}
                                    >
                                        {/* Receipt thumbnail */}
                                        <div style={{
                                            width: 64, height: 80,
                                            borderRadius: 10,
                                            overflow: 'hidden',
                                            flexShrink: 0,
                                            position: 'relative',
                                            background: 'var(--bg-primary)',
                                            border: '1px solid var(--border-subtle)',
                                        }}>
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            <img
                                                src={receipt.receiptUrl}
                                                alt={receipt.title}
                                                style={{
                                                    width: '100%', height: '100%',
                                                    objectFit: 'cover',
                                                }}
                                                loading="lazy"
                                            />
                                            {/* Zoom hint */}
                                            <div style={{
                                                position: 'absolute', inset: 0,
                                                background: 'rgba(0,0,0,0.15)',
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                opacity: 0, transition: 'opacity 0.2s',
                                            }}>
                                                <ZoomIn size={16} style={{ color: 'white' }} />
                                            </div>
                                        </div>

                                        {/* Receipt details */}
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <p style={{
                                                margin: 0, fontSize: 14, fontWeight: 600,
                                                color: 'var(--fg-primary)',
                                                overflow: 'hidden', textOverflow: 'ellipsis',
                                                whiteSpace: 'nowrap',
                                            }}>
                                                {receipt.title}
                                            </p>

                                            <div style={{
                                                display: 'flex', alignItems: 'center', gap: 6,
                                                marginTop: 4,
                                            }}>
                                                <span style={{
                                                    fontSize: 11, color: 'var(--fg-tertiary)',
                                                    display: 'flex', alignItems: 'center', gap: 3,
                                                }}>
                                                    {CAT_EMOJI[receipt.category] || '📦'} {receipt.category}
                                                </span>
                                                <span style={{ color: 'var(--border-subtle)' }}>·</span>
                                                <span style={{
                                                    fontSize: 11, color: 'var(--fg-muted)',
                                                }}>
                                                    {timeAgo(receipt.date)}
                                                </span>
                                            </div>

                                            <div style={{
                                                display: 'flex', alignItems: 'center', gap: 5,
                                                marginTop: 6,
                                            }}>
                                                <Avatar name={receipt.payer.name || 'U'} image={receipt.payer.image} size="xs" />
                                                <span style={{
                                                    fontSize: 11, color: 'var(--fg-tertiary)',
                                                    fontWeight: 500,
                                                }}>
                                                    {receipt.payer.name?.split(' ')[0] || 'Unknown'}
                                                </span>
                                            </div>
                                        </div>

                                        {/* Amount */}
                                        <div style={{
                                            textAlign: 'right', flexShrink: 0,
                                        }}>
                                            <span style={{
                                                fontSize: 15, fontWeight: 800,
                                                color: 'var(--accent-500)',
                                            }}>
                                                {formatCurrency(receipt.amount)}
                                            </span>
                                        </div>
                                    </motion.div>
                                ))}
                            </div>
                        </div>
                    ))}

                    {/* Summary footer */}
                    <div style={{
                        textAlign: 'center', padding: '16px 0 8px',
                        color: 'var(--fg-muted)', fontSize: 12, fontWeight: 500,
                    }}>
                        {filtered.length} receipt{filtered.length !== 1 ? 's' : ''} ·{' '}
                        Total: {formatCurrency(filtered.reduce((s, r) => s + r.amount, 0))}
                    </div>
                </div>
            )}

            {/* ── Full-size Receipt Lightbox (Portal for correct z-index) ── */}
            {typeof document !== 'undefined' && createPortal(
                <AnimatePresence>
                    {selectedReceipt && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => setSelectedReceipt(null)}
                            style={{
                                position: 'fixed', inset: 0, zIndex: 9999,
                                background: 'rgba(0,0,0,0.9)',
                                backdropFilter: 'blur(16px)',
                                WebkitBackdropFilter: 'blur(16px)',
                                display: 'flex', flexDirection: 'column',
                                alignItems: 'center', justifyContent: 'center',
                                padding: 20,
                            }}
                        >
                            {/* Close button */}
                            <button
                                onClick={() => setSelectedReceipt(null)}
                                style={{
                                    position: 'absolute', top: 20, right: 20,
                                    width: 40, height: 40, borderRadius: '50%',
                                    background: 'rgba(255,255,255,0.1)',
                                    border: '1px solid rgba(255,255,255,0.1)',
                                    cursor: 'pointer',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    color: 'white', zIndex: 10,
                                    transition: 'background 0.2s',
                                }}
                            >
                                <X size={18} />
                            </button>

                            {/* Receipt image */}
                            <motion.img
                                initial={{ scale: 0.85, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                exit={{ scale: 0.85, opacity: 0 }}
                                transition={{ type: 'spring', damping: 20, stiffness: 250 }}
                                src={selectedReceipt.receiptUrl}
                                alt={selectedReceipt.title}
                                onClick={(e) => e.stopPropagation()}
                                style={{
                                    maxWidth: 'min(90vw, 480px)',
                                    maxHeight: '65vh',
                                    borderRadius: 16,
                                    boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
                                    objectFit: 'contain',
                                }}
                            />

                            {/* Info card */}
                            <motion.div
                                initial={{ y: 20, opacity: 0 }}
                                animate={{ y: 0, opacity: 1 }}
                                transition={{ delay: 0.1 }}
                                onClick={(e) => e.stopPropagation()}
                                style={{
                                    marginTop: 16, padding: '14px 24px',
                                    borderRadius: 16,
                                    background: 'rgba(255,255,255,0.08)',
                                    backdropFilter: 'blur(24px)',
                                    border: '1px solid rgba(255,255,255,0.1)',
                                    display: 'flex', alignItems: 'center', gap: 16,
                                    color: 'white',
                                    maxWidth: 'min(90vw, 480px)', width: '100%',
                                }}
                            >
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <p style={{
                                        margin: 0, fontSize: 15, fontWeight: 700,
                                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                    }}>
                                        {selectedReceipt.title}
                                    </p>
                                    <div style={{
                                        display: 'flex', alignItems: 'center', gap: 8,
                                        marginTop: 4, fontSize: 12, opacity: 0.7,
                                        flexWrap: 'wrap',
                                    }}>
                                        <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                                            <Calendar size={11} />
                                            {new Date(selectedReceipt.date).toLocaleDateString('en-IN', {
                                                day: 'numeric', month: 'short', year: 'numeric',
                                            })}
                                        </span>
                                        <span>·</span>
                                        <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                                            <User size={11} />
                                            {selectedReceipt.payer.name}
                                        </span>
                                        <span>·</span>
                                        <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                                            <Tag size={11} />
                                            {selectedReceipt.category}
                                        </span>
                                    </div>
                                </div>
                                <div style={{
                                    fontSize: 20, fontWeight: 800,
                                    color: 'var(--accent-400)',
                                    flexShrink: 0,
                                }}>
                                    {formatCurrency(selectedReceipt.amount)}
                                </div>
                            </motion.div>
                        </motion.div>
                    )}
                </AnimatePresence>,
                document.body
            )}
        </div>
    );
}
