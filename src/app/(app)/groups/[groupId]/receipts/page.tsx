'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Image as ImageIcon, X, ChevronLeft, Loader2,
    Calendar, User, Tag, Receipt, ZoomIn,
    Filter, ChevronDown,
} from 'lucide-react';
import Avatar from '@/components/ui/Avatar';
import Badge from '@/components/ui/Badge';
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

/* ── Glass styles ── */
const glass: React.CSSProperties = {
    background: 'var(--bg-glass)',
    backdropFilter: 'blur(20px) saturate(1.4)',
    WebkitBackdropFilter: 'blur(20px) saturate(1.4)',
    border: '1px solid var(--border-glass)',
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

    return (
        <div style={{
            minHeight: '100dvh', padding: '0 16px 32px',
            maxWidth: 520, margin: '0 auto',
        }}>
            {/* ── Header ── */}
            <div style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '20px 0 16px',
                position: 'sticky', top: 0, zIndex: 10,
                background: 'var(--bg-primary)',
            }}>
                <button
                    onClick={() => router.back()}
                    style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        color: 'var(--fg-secondary)', padding: 4,
                        display: 'flex', alignItems: 'center',
                    }}
                >
                    <ChevronLeft size={22} />
                </button>
                <div style={{ flex: 1 }}>
                    <h1 style={{
                        margin: 0, fontSize: 'var(--text-xl)', fontWeight: 800,
                        color: 'var(--fg-primary)',
                        display: 'flex', alignItems: 'center', gap: 8,
                    }}>
                        <Receipt size={20} style={{ color: 'var(--accent-400)' }} />
                        Receipts
                    </h1>
                    <p style={{
                        margin: '2px 0 0', fontSize: 'var(--text-xs)',
                        color: 'var(--fg-tertiary)',
                    }}>
                        {receipts.length} receipt{receipts.length !== 1 ? 's' : ''} captured
                    </p>
                </div>
                <button
                    onClick={() => setFilterOpen(!filterOpen)}
                    style={{
                        display: 'flex', alignItems: 'center', gap: 4,
                        padding: '6px 12px', borderRadius: 'var(--radius-lg)',
                        ...glass, cursor: 'pointer',
                        color: filterMember === 'all' ? 'var(--fg-tertiary)' : 'var(--accent-400)',
                        fontSize: 12, fontWeight: 600,
                    }}
                >
                    <Filter size={14} />
                    Filter
                    <ChevronDown size={12} style={{
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
                            ...glass, borderRadius: 'var(--radius-xl)',
                            padding: 12,
                        }}>
                            <button
                                onClick={() => { setFilterMember('all'); setFilterOpen(false); }}
                                style={{
                                    padding: '5px 12px', borderRadius: 20,
                                    border: 'none', cursor: 'pointer',
                                    background: filterMember === 'all'
                                        ? 'rgba(var(--accent-500-rgb), 0.15)'
                                        : 'var(--surface-secondary)',
                                    color: filterMember === 'all'
                                        ? 'var(--accent-400)'
                                        : 'var(--fg-tertiary)',
                                    fontSize: 11, fontWeight: 600,
                                }}
                            >
                                All
                            </button>
                            {members.map(m => (
                                <button
                                    key={m.id}
                                    onClick={() => { setFilterMember(m.id); setFilterOpen(false); }}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: 4,
                                        padding: '4px 10px 4px 4px', borderRadius: 20,
                                        border: 'none', cursor: 'pointer',
                                        background: filterMember === m.id
                                            ? 'rgba(var(--accent-500-rgb), 0.15)'
                                            : 'var(--surface-secondary)',
                                        color: filterMember === m.id
                                            ? 'var(--accent-400)'
                                            : 'var(--fg-tertiary)',
                                        fontSize: 11, fontWeight: 600,
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
                    justifyContent: 'center', padding: 60, gap: 12,
                    color: 'var(--fg-tertiary)',
                }}>
                    <Loader2 size={24} className="animate-spin" />
                    <span style={{ fontSize: 'var(--text-sm)' }}>Loading receipts...</span>
                </div>
            ) : filtered.length === 0 ? (
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    style={{
                        display: 'flex', flexDirection: 'column', alignItems: 'center',
                        justifyContent: 'center', padding: '60px 20px', gap: 12,
                        textAlign: 'center',
                    }}
                >
                    <div style={{
                        width: 64, height: 64, borderRadius: '50%',
                        background: 'rgba(var(--accent-500-rgb), 0.08)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                        <ImageIcon size={28} style={{ color: 'var(--fg-muted)' }} />
                    </div>
                    <p style={{
                        fontSize: 'var(--text-base)', fontWeight: 600,
                        color: 'var(--fg-secondary)', margin: 0,
                    }}>
                        No receipts yet
                    </p>
                    <p style={{
                        fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)',
                        maxWidth: 260, margin: 0,
                    }}>
                        Scan receipts when adding expenses to build your group&apos;s receipt gallery
                    </p>
                </motion.div>
            ) : (
                /* ── 2-Column Masonry Grid ── */
                <div style={{
                    display: 'grid', gridTemplateColumns: '1fr 1fr',
                    gap: 10,
                }}>
                    {filtered.map((receipt, idx) => (
                        <motion.div
                            key={receipt.id}
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: idx * 0.04 }}
                            onClick={() => setSelectedReceipt(receipt)}
                            style={{
                                borderRadius: 'var(--radius-xl)',
                                overflow: 'hidden',
                                cursor: 'pointer',
                                ...glass,
                                position: 'relative',
                                transition: 'transform 0.2s, box-shadow 0.2s',
                            }}
                            whileHover={{ scale: 1.02, boxShadow: '0 8px 30px rgba(0,0,0,0.15)' }}
                            whileTap={{ scale: 0.97 }}
                        >
                            {/* Receipt Image */}
                            <div style={{
                                width: '100%', aspectRatio: '3/4',
                                background: 'var(--surface-secondary)',
                                position: 'relative',
                                overflow: 'hidden',
                            }}>
                                <img
                                    src={receipt.receiptUrl}
                                    alt={receipt.title}
                                    style={{
                                        width: '100%', height: '100%',
                                        objectFit: 'cover',
                                    }}
                                    loading="lazy"
                                />
                                {/* Overlay gradient */}
                                <div style={{
                                    position: 'absolute', bottom: 0, left: 0, right: 0,
                                    height: '50%',
                                    background: 'linear-gradient(transparent, rgba(0,0,0,0.7))',
                                    pointerEvents: 'none',
                                }} />
                                {/* Amount badge */}
                                <div style={{
                                    position: 'absolute', bottom: 8, left: 8,
                                    color: 'white', fontSize: 'var(--text-sm)',
                                    fontWeight: 800,
                                    textShadow: '0 1px 4px rgba(0,0,0,0.5)',
                                }}>
                                    {formatCurrency(receipt.amount)}
                                </div>
                                {/* Zoom icon */}
                                <div style={{
                                    position: 'absolute', top: 8, right: 8,
                                    width: 28, height: 28, borderRadius: '50%',
                                    background: 'rgba(0,0,0,0.4)',
                                    backdropFilter: 'blur(8px)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                }}>
                                    <ZoomIn size={13} style={{ color: 'white' }} />
                                </div>
                            </div>

                            {/* Info bar */}
                            <div style={{ padding: '8px 10px' }}>
                                <p style={{
                                    margin: 0, fontSize: 11, fontWeight: 600,
                                    color: 'var(--fg-primary)',
                                    overflow: 'hidden', textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                }}>
                                    {receipt.title}
                                </p>
                                <div style={{
                                    display: 'flex', alignItems: 'center', gap: 4,
                                    marginTop: 3,
                                }}>
                                    <Avatar name={receipt.payer.name || 'U'} image={receipt.payer.image} size="xs" />
                                    <span style={{
                                        fontSize: 10, color: 'var(--fg-tertiary)',
                                        overflow: 'hidden', textOverflow: 'ellipsis',
                                        whiteSpace: 'nowrap',
                                    }}>
                                        {receipt.payer.name?.split(' ')[0]} · {timeAgo(receipt.date)}
                                    </span>
                                </div>
                            </div>
                        </motion.div>
                    ))}
                </div>
            )}

            {/* ── Full-size Receipt Overlay ── */}
            <AnimatePresence>
                {selectedReceipt && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={() => setSelectedReceipt(null)}
                        style={{
                            position: 'fixed', inset: 0, zIndex: 9999,
                            background: 'rgba(0,0,0,0.85)',
                            backdropFilter: 'blur(12px)',
                            display: 'flex', flexDirection: 'column',
                            alignItems: 'center', justifyContent: 'center',
                        }}
                    >
                        {/* Close button */}
                        <button
                            onClick={() => setSelectedReceipt(null)}
                            style={{
                                position: 'absolute', top: 16, right: 16,
                                width: 40, height: 40, borderRadius: '50%',
                                background: 'rgba(255,255,255,0.1)',
                                border: 'none', cursor: 'pointer',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                color: 'white', zIndex: 10,
                            }}
                        >
                            <X size={20} />
                        </button>

                        {/* Receipt image */}
                        <motion.img
                            initial={{ scale: 0.85, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.85, opacity: 0 }}
                            src={selectedReceipt.receiptUrl}
                            alt={selectedReceipt.title}
                            onClick={(e) => e.stopPropagation()}
                            style={{
                                maxWidth: '90vw', maxHeight: '70vh',
                                borderRadius: 16,
                                boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
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
                                borderRadius: 'var(--radius-xl)',
                                background: 'rgba(255,255,255,0.08)',
                                backdropFilter: 'blur(24px)',
                                border: '1px solid rgba(255,255,255,0.1)',
                                display: 'flex', alignItems: 'center', gap: 16,
                                color: 'white',
                                maxWidth: '90vw',
                            }}
                        >
                            <div style={{ flex: 1 }}>
                                <p style={{
                                    margin: 0, fontSize: 'var(--text-base)', fontWeight: 700,
                                }}>
                                    {selectedReceipt.title}
                                </p>
                                <div style={{
                                    display: 'flex', alignItems: 'center', gap: 8,
                                    marginTop: 4, fontSize: 12, opacity: 0.7,
                                }}>
                                    <Calendar size={12} />
                                    {new Date(selectedReceipt.date).toLocaleDateString('en-IN', {
                                        day: 'numeric', month: 'short', year: 'numeric',
                                    })}
                                    <span>·</span>
                                    <User size={12} />
                                    {selectedReceipt.payer.name}
                                    <span>·</span>
                                    <Tag size={12} />
                                    {selectedReceipt.category}
                                </div>
                            </div>
                            <div style={{
                                fontSize: 'var(--text-xl)', fontWeight: 800,
                                background: 'linear-gradient(135deg, #fff, rgba(var(--accent-400-rgb, 168, 85, 247), 1))',
                                WebkitBackgroundClip: 'text',
                                WebkitTextFillColor: 'transparent',
                            }}>
                                {formatCurrency(selectedReceipt.amount)}
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
