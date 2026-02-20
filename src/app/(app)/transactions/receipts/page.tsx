'use client';

import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Search, Image as ImageIcon, Calendar, Receipt } from 'lucide-react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { formatCurrency, timeAgo } from '@/lib/utils';

/* ── Glassmorphic styles ── */
const glass: React.CSSProperties = {
    background: 'var(--bg-glass)',
    backdropFilter: 'blur(24px) saturate(1.5)',
    WebkitBackdropFilter: 'blur(24px) saturate(1.5)',
    border: '1px solid var(--border-glass)',
    borderRadius: 'var(--radius-xl)',
    boxShadow: 'var(--shadow-card)',
    overflow: 'hidden',
};

interface ReceiptItem {
    id: string;
    title: string;
    amount: number;
    category: string;
    createdAt: string;
    receiptUrl: string | null;
    localThumb?: string; // base64 from localStorage
}

const CATEGORY_EMOJI: Record<string, string> = {
    food: '🍕', transport: '🚗', accommodation: '🏨',
    shopping: '🛍️', entertainment: '🎬', general: '📋', other: '📦',
};

export default function ReceiptGalleryPage() {
    const router = useRouter();
    const [receipts, setReceipts] = useState<ReceiptItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [selectedReceipt, setSelectedReceipt] = useState<ReceiptItem | null>(null);

    useEffect(() => {
        const fetchReceipts = async () => {
            try {
                // Fetch transactions with receiptUrl
                const res = await fetch('/api/transactions?limit=100');
                const data = res.ok ? await res.json() : [];
                const txns = Array.isArray(data) ? data : [];

                // Also check localStorage for locally stored receipt thumbnails
                const localReceipts: Record<string, string> = {};
                try {
                    const stored = localStorage.getItem('SplitX_receipts');
                    if (stored) {
                        const parsed = JSON.parse(stored);
                        Object.assign(localReceipts, parsed);
                    }
                } catch { }

                // Merge: transactions with receiptUrl + localStorage thumbnails
                const items: ReceiptItem[] = txns
                    .filter((t: ReceiptItem & { receiptUrl?: string | null }) => t.receiptUrl || localReceipts[t.id])
                    .map((t: ReceiptItem & { receiptUrl?: string | null }) => ({
                        id: t.id,
                        title: t.title,
                        amount: t.amount,
                        category: t.category || 'general',
                        createdAt: t.createdAt,
                        receiptUrl: t.receiptUrl || null,
                        localThumb: localReceipts[t.id] || undefined,
                    }));

                setReceipts(items);
            } catch (err) {
                console.error('Failed to fetch receipts:', err);
            } finally {
                setLoading(false);
            }
        };
        fetchReceipts();
    }, []);

    const filtered = useMemo(() => {
        if (!search) return receipts;
        return receipts.filter(r =>
            r.title.toLowerCase().includes(search.toLowerCase())
        );
    }, [receipts, search]);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                <button
                    onClick={() => router.back()}
                    style={{
                        border: 'none', background: 'none', cursor: 'pointer',
                        color: 'var(--fg-secondary)', display: 'flex', padding: 4,
                    }}
                >
                    <ArrowLeft size={20} />
                </button>
                <div style={{ flex: 1 }}>
                    <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 700 }}>📸 Receipt Gallery</h2>
                    <p style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)' }}>
                        {receipts.length} receipt{receipts.length !== 1 ? 's' : ''} saved
                    </p>
                </div>
            </div>

            {/* Search */}
            <div style={{
                display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                ...glass, borderRadius: 'var(--radius-xl)', padding: '0 var(--space-3)', height: 42,
            }}>
                <Search size={15} style={{ color: 'var(--fg-tertiary)', flexShrink: 0 }} />
                <input
                    placeholder="Search receipts..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    style={{
                        flex: 1, background: 'none', border: 'none', outline: 'none',
                        fontSize: 'var(--text-sm)', color: 'var(--fg-primary)',
                    }}
                />
            </div>

            {/* Gallery Grid */}
            {loading ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 'var(--space-3)' }}>
                    {[1, 2, 3, 4].map(i => (
                        <div key={i} style={{
                            ...glass, height: 180,
                            animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
                            animationDelay: `${i * 100}ms`,
                        }} />
                    ))}
                </div>
            ) : filtered.length > 0 ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 'var(--space-3)' }}>
                    {filtered.map((r, i) => (
                        <motion.div
                            key={r.id}
                            initial={{ opacity: 0, scale: 0.92 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ delay: i * 0.05, duration: 0.3 }}
                            onClick={() => setSelectedReceipt(r)}
                            style={{ cursor: 'pointer' }}
                        >
                            <div style={{
                                ...glass,
                                transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
                            }}
                                onMouseEnter={e => {
                                    e.currentTarget.style.transform = 'translateY(-3px) scale(1.02)';
                                    e.currentTarget.style.boxShadow = 'var(--shadow-card-hover)';
                                }}
                                onMouseLeave={e => {
                                    e.currentTarget.style.transform = '';
                                    e.currentTarget.style.boxShadow = '';
                                }}
                            >
                                {/* Thumbnail */}
                                <div style={{
                                    height: 120,
                                    background: 'rgba(var(--accent-500-rgb), 0.04)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    overflow: 'hidden',
                                }}>
                                    {r.receiptUrl || r.localThumb ? (
                                        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
                                            <Image
                                                src={r.receiptUrl || r.localThumb!}
                                                alt={r.title}
                                                fill
                                                sizes="(max-width: 768px) 50vw, 33vw"
                                                style={{ objectFit: 'cover' }}
                                            />
                                        </div>
                                    ) : (
                                        <ImageIcon size={32} style={{ color: 'var(--fg-muted)' }} />
                                    )}
                                </div>
                                {/* Info */}
                                <div style={{ padding: 'var(--space-2) var(--space-3)' }}>
                                    <div style={{
                                        fontSize: 'var(--text-xs)', fontWeight: 600,
                                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                    }}>
                                        {CATEGORY_EMOJI[r.category] || '📦'} {r.title}
                                    </div>
                                    <div style={{
                                        display: 'flex', justifyContent: 'space-between',
                                        fontSize: 'var(--text-2xs)', color: 'var(--fg-tertiary)',
                                        marginTop: 2,
                                    }}>
                                        <span>{formatCurrency(r.amount)}</span>
                                        <span>{timeAgo(r.createdAt)}</span>
                                    </div>
                                </div>
                            </div>
                        </motion.div>
                    ))}
                </div>
            ) : (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                    <div style={{
                        ...glass, padding: 'var(--space-10) var(--space-4)',
                        textAlign: 'center',
                        background: 'linear-gradient(135deg, rgba(var(--accent-500-rgb), 0.04), var(--bg-glass))',
                    }}>
                        <div style={{
                            width: 56, height: 56, borderRadius: 'var(--radius-2xl)',
                            background: 'rgba(var(--accent-500-rgb), 0.08)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            margin: '0 auto var(--space-3)', color: 'var(--accent-400)',
                        }}>
                            <Receipt size={26} />
                        </div>
                        <div style={{ fontWeight: 600, marginBottom: 4 }}>
                            {search ? 'No receipts match your search' : 'No scanned receipts yet'}
                        </div>
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)', marginBottom: 'var(--space-4)' }}>
                            {search ? 'Try a different search term' : 'Scan your first receipt to see it here'}
                        </div>
                        {!search && (
                            <button
                                onClick={() => router.push('/transactions/scan')}
                                style={{
                                    padding: '10px 20px', borderRadius: 'var(--radius-xl)',
                                    background: 'linear-gradient(135deg, var(--accent-500), var(--accent-600))',
                                    border: 'none', color: 'white', fontWeight: 700,
                                    fontSize: 'var(--text-sm)', cursor: 'pointer',
                                    boxShadow: '0 4px 16px rgba(var(--accent-500-rgb), 0.3)',
                                }}
                            >
                                Scan Receipt
                            </button>
                        )}
                    </div>
                </motion.div>
            )}

            {/* Receipt Detail Modal */}
            <AnimatePresence>
                {selectedReceipt && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={() => setSelectedReceipt(null)}
                        style={{
                            position: 'fixed', inset: 0, zIndex: 9000,
                            background: 'rgba(0,0,0,0.7)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            padding: 'var(--space-4)',
                        }}
                    >
                        <motion.div
                            initial={{ scale: 0.85, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.85, opacity: 0 }}
                            onClick={e => e.stopPropagation()}
                            style={{
                                ...glass, width: '100%', maxWidth: 420,
                                borderRadius: 'var(--radius-2xl)',
                                overflow: 'hidden',
                            }}
                        >
                            {/* Image */}
                            {(selectedReceipt.receiptUrl || selectedReceipt.localThumb) && (
                                <div style={{ position: 'relative', width: '100%', height: '400px', background: '#000' }}>
                                    <Image
                                        src={selectedReceipt.receiptUrl || selectedReceipt.localThumb!}
                                        alt={selectedReceipt.title}
                                        fill
                                        style={{ objectFit: 'contain' }}
                                    />
                                </div>
                            )}
                            <div style={{ padding: 'var(--space-4)' }}>
                                <div style={{ fontSize: 'var(--text-base)', fontWeight: 700, marginBottom: 4 }}>
                                    {selectedReceipt.title}
                                </div>
                                <div style={{ display: 'flex', gap: 'var(--space-4)', color: 'var(--fg-tertiary)', fontSize: 'var(--text-sm)' }}>
                                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                        💰 {formatCurrency(selectedReceipt.amount)}
                                    </span>
                                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                        <Calendar size={13} /> {new Date(selectedReceipt.createdAt).toLocaleDateString('en-IN')}
                                    </span>
                                </div>
                                <button
                                    onClick={() => setSelectedReceipt(null)}
                                    style={{
                                        marginTop: 'var(--space-4)', width: '100%',
                                        padding: '10px 0', borderRadius: 'var(--radius-xl)',
                                        border: '1px solid var(--border-default)',
                                        background: 'transparent', color: 'var(--fg-secondary)',
                                        fontWeight: 600, cursor: 'pointer',
                                    }}
                                >
                                    Close
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
