'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Search, ArrowUpDown, ScanLine, Inbox, Trash2, Sparkles, Receipt, Pencil, Check, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import { CategoryIcon, PaymentIcon, CATEGORY_ICONS, PAYMENT_ICONS } from '@/components/ui/Icons';
import { formatCurrency, timeAgo } from '@/lib/utils';
import { useToast } from '@/components/ui/Toast';

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

interface TransactionData {
    id: string;
    title: string;
    category: string;
    amount: number;
    method: string;
    createdAt: string;
    payer: { id: string; name: string | null };
    splits: { userId: string; amount: number; user: { id: string; name: string | null } }[];
}

type SortKey = 'time' | 'amount';

export default function TransactionsPage() {
    const router = useRouter();
    const [transactions, setTransactions] = useState<TransactionData[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [sortBy, setSortBy] = useState<SortKey>('time');
    const [filterCategory, setFilterCategory] = useState<string | null>(null);
    const { toast } = useToast();
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editTitle, setEditTitle] = useState('');
    const [editAmount, setEditAmount] = useState('');
    const [savingEdit, setSavingEdit] = useState(false);

    const startEdit = (txn: TransactionData) => {
        setEditingId(txn.id);
        setEditTitle(txn.title);
        setEditAmount(String(txn.amount / 100));
    };

    const saveEdit = async (txnId: string) => {
        if (!editTitle.trim() || !parseFloat(editAmount)) return;
        setSavingEdit(true);
        try {
            const res = await fetch(`/api/transactions/${txnId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: editTitle.trim(),
                    amount: Math.round(parseFloat(editAmount) * 100),
                }),
            });
            if (res.ok) {
                toast('Transaction updated!', 'success');
                setEditingId(null);
                fetchTransactions();
            } else toast('Failed to update', 'error');
        } catch { toast('Network error', 'error'); }
        finally { setSavingEdit(false); }
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Delete this expense?')) return;
        setDeletingId(id);
        try {
            const res = await fetch(`/api/transactions/${id}`, { method: 'DELETE' });
            if (res.ok) {
                setTransactions(prev => prev.filter(t => t.id !== id));
                toast('Expense deleted', 'success');
            } else {
                toast('Failed to delete expense', 'error');
            }
        } catch {
            toast('Network error', 'error');
        } finally {
            setDeletingId(null);
        }
    };

    const fetchTransactions = useCallback(async () => {
        try {
            const res = await fetch('/api/transactions?limit=50');
            if (res.ok) {
                const data = await res.json();
                setTransactions(Array.isArray(data) ? data : []);
            }
        } catch (err) {
            console.error('Failed to fetch transactions:', err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchTransactions(); }, [fetchTransactions]);

    let filtered = transactions;
    if (search) {
        filtered = filtered.filter((t) =>
            t.title.toLowerCase().includes(search.toLowerCase()) ||
            (t.payer.name || '').toLowerCase().includes(search.toLowerCase())
        );
    }
    if (filterCategory) {
        filtered = filtered.filter((t) => t.category === filterCategory);
    }
    if (sortBy === 'amount') {
        filtered = [...filtered].sort((a, b) => b.amount - a.amount);
    }

    const totalSpent = filtered.reduce((sum, t) => sum + t.amount, 0);

    if (loading) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', padding: 'var(--space-4) 0' }}>
                {[1, 2, 3, 4].map(i => (
                    <div key={i} style={{
                        ...glass, padding: 'var(--space-4)',
                        animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
                        animationDelay: `${i * 150}ms`,
                    }}>
                        <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
                            <div style={{ width: 40, height: 40, borderRadius: 'var(--radius-lg)', background: 'rgba(var(--accent-500-rgb), 0.06)' }} />
                            <div style={{ flex: 1 }}>
                                <div style={{ width: '55%', height: 12, borderRadius: 8, background: 'rgba(var(--accent-500-rgb), 0.08)', marginBottom: 6 }} />
                                <div style={{ width: '35%', height: 10, borderRadius: 6, background: 'rgba(var(--accent-500-rgb), 0.05)' }} />
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        );
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            {/* ═══ HEADER — Gradient title + action buttons ═══ */}
            <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
            >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                            <Receipt size={14} style={{ color: 'var(--accent-400)' }} />
                            <span style={{
                                fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)',
                                fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em',
                            }}>
                                Expenses
                            </span>
                        </div>
                        <h2 style={{
                            fontSize: 'var(--text-xl)', fontWeight: 800,
                            background: 'linear-gradient(135deg, var(--fg-primary), var(--accent-400))',
                            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
                        }}>
                            Transactions
                        </h2>
                        <p style={{ color: 'var(--fg-tertiary)', fontSize: 'var(--text-xs)', marginTop: 2 }}>
                            {formatCurrency(totalSpent)} · {filtered.length} items
                        </p>
                    </div>
                    <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                        <button
                            onClick={() => router.push('/transactions/scan')}
                            style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                width: 36, height: 36, borderRadius: 'var(--radius-lg)',
                                background: 'var(--bg-glass)', backdropFilter: 'blur(12px)',
                                WebkitBackdropFilter: 'blur(12px)',
                                border: '1px solid var(--border-glass)',
                                color: 'var(--fg-secondary)', cursor: 'pointer', transition: 'all 0.2s',
                            }}
                        >
                            <ScanLine size={16} />
                        </button>
                        <button
                            onClick={() => router.push('/transactions/new')}
                            style={{
                                display: 'flex', alignItems: 'center', gap: 6,
                                padding: '8px 14px', borderRadius: 'var(--radius-full)',
                                background: 'linear-gradient(135deg, var(--accent-500), var(--accent-600))',
                                border: 'none', color: 'white', fontSize: 'var(--text-xs)', fontWeight: 700,
                                cursor: 'pointer', boxShadow: '0 4px 16px rgba(var(--accent-500-rgb), 0.3)',
                            }}
                        >
                            <Plus size={14} /> Add
                        </button>
                    </div>
                </div>
            </motion.div>

            {/* ═══ SEARCH BAR — Glassmorphic ═══ */}
            <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.05 }}
            >
                <div style={{
                    display: 'flex', gap: 'var(--space-2)', alignItems: 'center',
                }}>
                    <div style={{
                        flex: 1, display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                        ...glass, borderRadius: 'var(--radius-xl)', padding: '0 var(--space-3)',
                        height: 42,
                    }}>
                        <Search size={15} style={{ color: 'var(--fg-tertiary)', flexShrink: 0 }} />
                        <input
                            placeholder="Search expenses..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            style={{
                                flex: 1, background: 'none', border: 'none', outline: 'none',
                                fontSize: 'var(--text-sm)', color: 'var(--fg-primary)',
                            }}
                        />
                    </div>
                    <button
                        onClick={() => setSortBy(sortBy === 'time' ? 'amount' : 'time')}
                        style={{
                            width: 42, height: 42, borderRadius: 'var(--radius-xl)',
                            ...glass, display: 'flex', alignItems: 'center', justifyContent: 'center',
                            cursor: 'pointer', color: sortBy === 'amount' ? 'var(--accent-400)' : 'var(--fg-tertiary)',
                            transition: 'all 0.2s',
                        }}
                        title={`Sort by ${sortBy === 'time' ? 'amount' : 'time'}`}
                    >
                        <ArrowUpDown size={15} />
                    </button>
                </div>
            </motion.div>

            {/* ═══ CATEGORY FILTER PILLS — Glassmorphic ═══ */}
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.4, delay: 0.1 }}
            >
                <div style={{
                    display: 'flex', gap: 6, overflowX: 'auto',
                    scrollbarWidth: 'none', paddingBottom: 2,
                }}>
                    <FilterPill
                        active={!filterCategory}
                        onClick={() => setFilterCategory(null)}
                    >
                        All
                    </FilterPill>
                    {Object.entries(CATEGORY_ICONS).slice(0, 6).map(([key, val]) => (
                        <FilterPill
                            key={key}
                            active={filterCategory === key}
                            onClick={() => setFilterCategory(filterCategory === key ? null : key)}
                        >
                            <CategoryIcon category={key} size={13} /> {val.label}
                        </FilterPill>
                    ))}
                </div>
            </motion.div>

            {/* ═══ TRANSACTION LIST — Glassmorphic Cards ═══ */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                <AnimatePresence mode="popLayout">
                    {filtered.map((txn, i) => {
                        const catConfig = CATEGORY_ICONS[txn.category] || CATEGORY_ICONS.general;
                        const metConfig = PAYMENT_ICONS[txn.method] || PAYMENT_ICONS.cash;
                        const payerName = txn.payer.name || 'Unknown';
                        return (
                            <motion.div
                                key={txn.id}
                                layout
                                initial={{ opacity: 0, y: 12 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, scale: 0.95 }}
                                transition={{ duration: 0.3, delay: Math.min(i * 0.03, 0.3) }}
                            >
                                <div style={{
                                    ...glass,
                                    padding: 'var(--space-3) var(--space-4)',
                                    cursor: editingId === txn.id ? 'default' : 'pointer',
                                    transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
                                }}
                                    onMouseEnter={(e) => {
                                        if (editingId !== txn.id) {
                                            e.currentTarget.style.transform = 'translateY(-2px)';
                                            e.currentTarget.style.boxShadow = 'var(--shadow-card-hover)';
                                        }
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.transform = 'translateY(0)';
                                        e.currentTarget.style.boxShadow = '';
                                    }}
                                >
                                    {editingId === txn.id ? (
                                        /* Inline edit mode */
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                                            <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)}
                                                style={{ background: 'var(--surface-input)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-lg)', padding: '8px 12px', color: 'var(--fg-primary)', fontSize: 'var(--text-sm)', outline: 'none', width: '100%' }}
                                                placeholder="Title" />
                                            <input value={editAmount} onChange={(e) => setEditAmount(e.target.value)} type="number" step="0.01"
                                                style={{ background: 'var(--surface-input)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-lg)', padding: '8px 12px', color: 'var(--fg-primary)', fontSize: 'var(--text-sm)', outline: 'none', width: '100%' }}
                                                placeholder="Amount (₹)" />
                                            <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
                                                <button onClick={() => setEditingId(null)} style={{ padding: '6px 12px', borderRadius: 'var(--radius-full)', background: 'var(--bg-glass)', border: '1px solid var(--border-glass)', color: 'var(--fg-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: '12px' }}>
                                                    <X size={13} /> Cancel
                                                </button>
                                                <button onClick={() => saveEdit(txn.id)} disabled={savingEdit} style={{ padding: '6px 12px', borderRadius: 'var(--radius-full)', background: 'var(--accent-500)', border: 'none', color: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: '12px', opacity: savingEdit ? 0.6 : 1 }}>
                                                    <Check size={13} /> Save
                                                </button>
                                            </div>
                                        </div>
                                    ) : (
                                        <div style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                                            {/* Category icon */}
                                            <div style={{
                                                width: 42, height: 42, borderRadius: 'var(--radius-lg)',
                                                background: `linear-gradient(135deg, ${catConfig.color}18, ${catConfig.color}08)`,
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                flexShrink: 0, color: catConfig.color,
                                            }}>
                                                <CategoryIcon category={txn.category} size={19} />
                                            </div>
                                            {/* Details */}
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{
                                                    fontSize: 'var(--text-sm)', fontWeight: 600,
                                                    color: 'var(--fg-primary)',
                                                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                                }}>
                                                    {txn.title}
                                                </div>
                                                <div style={{
                                                    fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)',
                                                    display: 'flex', gap: 4, alignItems: 'center', marginTop: 2,
                                                }}>
                                                    <span>{payerName.split(' ')[0]}</span>
                                                    <span style={{ opacity: 0.3 }}>·</span>
                                                    <span>{timeAgo(txn.createdAt)}</span>
                                                    <span style={{ opacity: 0.3 }}>·</span>
                                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                                                        <PaymentIcon method={txn.method} size={11} /> {metConfig.label}
                                                    </span>
                                                </div>
                                            </div>
                                            {/* Amount + edit + delete */}
                                            <div style={{ textAlign: 'right', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
                                                <div style={{ marginRight: 'var(--space-1)' }}>
                                                    <div style={{
                                                        fontWeight: 700, fontSize: 'var(--text-sm)',
                                                        background: 'linear-gradient(135deg, var(--accent-400), var(--accent-500))',
                                                        WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
                                                    }}>
                                                        {formatCurrency(txn.amount)}
                                                    </div>
                                                    <span style={{ fontSize: '10px', color: 'var(--fg-tertiary)' }}>
                                                        ÷{txn.splits?.length || 1}
                                                    </span>
                                                </div>
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); startEdit(txn); }}
                                                    style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--fg-muted)', padding: 4, borderRadius: 'var(--radius-md)', opacity: 0.5, transition: 'all 0.2s' }}
                                                    onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.color = 'var(--accent-400)'; }}
                                                    onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.5'; e.currentTarget.style.color = 'var(--fg-muted)'; }}
                                                    title="Edit"
                                                >
                                                    <Pencil size={13} />
                                                </button>
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); handleDelete(txn.id); }}
                                                    disabled={deletingId === txn.id}
                                                    style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--fg-muted)', padding: 4, borderRadius: 'var(--radius-md)', opacity: deletingId === txn.id ? 0.3 : 0.5, transition: 'all 0.2s' }}
                                                    onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.color = 'var(--color-error)'; }}
                                                    onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.5'; e.currentTarget.style.color = 'var(--fg-muted)'; }}
                                                    title="Delete"
                                                >
                                                    <Trash2 size={13} />
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </motion.div>
                        );
                    })}
                </AnimatePresence>
            </div>

            {/* ═══ EMPTY STATE — Glassmorphic ═══ */}
            {filtered.length === 0 && (
                <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                >
                    <div style={{
                        ...glass, borderRadius: 'var(--radius-2xl)',
                        padding: 'var(--space-10) var(--space-4)',
                        textAlign: 'center',
                        background: 'linear-gradient(135deg, rgba(var(--accent-500-rgb), 0.04), var(--bg-glass))',
                    }}>
                        <div style={{ position: 'relative', zIndex: 1 }}>
                            <div style={{
                                width: 56, height: 56, borderRadius: 'var(--radius-2xl)',
                                background: 'rgba(var(--accent-500-rgb), 0.08)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                margin: '0 auto var(--space-3)', color: 'var(--accent-400)',
                            }}>
                                <Inbox size={26} />
                            </div>
                            <div style={{ fontWeight: 600, color: 'var(--fg-primary)', marginBottom: 4 }}>
                                No transactions found
                            </div>
                            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)' }}>
                                {search || filterCategory ? 'Try adjusting your search or filters' : 'Add your first expense to get started'}
                            </div>
                        </div>
                    </div>
                </motion.div>
            )}
        </div>
    );
}

/* ── Filter Pill Sub-component ── */
function FilterPill({ active, onClick, children }: {
    active: boolean; onClick: () => void; children: React.ReactNode;
}) {
    return (
        <button
            onClick={onClick}
            style={{
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '6px 13px', borderRadius: 'var(--radius-full)',
                border: `1.5px solid ${active ? 'var(--accent-500)' : 'var(--border-glass)'}`,
                background: active ? 'rgba(var(--accent-500-rgb), 0.12)' : 'var(--bg-glass)',
                backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
                color: active ? 'var(--accent-400)' : 'var(--fg-secondary)',
                fontSize: 'var(--text-xs)', fontWeight: 600,
                cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
                transition: 'all 0.2s',
                boxShadow: active ? '0 0 12px rgba(var(--accent-500-rgb), 0.12)' : 'none',
            }}
        >
            {children}
        </button>
    );
}
