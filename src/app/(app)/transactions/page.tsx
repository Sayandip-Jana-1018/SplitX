'use client';

import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Search, ArrowUpDown, ScanLine, Inbox, Trash2, Pencil, Check, X, Clock, List, Users } from 'lucide-react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import { CategoryIcon, PaymentIcon, CATEGORY_ICONS, PAYMENT_ICONS } from '@/components/ui/Icons';
import { formatCurrency, timeAgo } from '@/lib/utils';
import { useToast } from '@/components/ui/Toast';
import { useCurrentUser } from '@/hooks/useCurrentUser';

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
    splitType?: string;
    trip?: { group: { ownerId?: string; members: { userId: string; user: { id: string; name: string | null; image: string | null } }[] } };
}

type SortKey = 'time' | 'amount';

export default function TransactionsPage() {
    const router = useRouter();
    const { user: currentUser } = useCurrentUser();
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
    const [editSplitAmong, setEditSplitAmong] = useState<Set<string>>(new Set());
    const [savingEdit, setSavingEdit] = useState(false);
    const [viewMode, setViewMode] = useState<'list' | 'timeline'>('list');
    const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
    const [focusId, setFocusId] = useState<string | null>(null);

    const startEdit = (txn: TransactionData) => {
        setEditingId(txn.id);
        setEditTitle(txn.title);
        setEditAmount(String(txn.amount / 100));
        setEditSplitAmong(new Set(txn.splits.map(s => s.userId)));
    };

    const canSaveTransaction = useCallback((txn: TransactionData) => {
        return Boolean(
            currentUser && (
                currentUser.id === txn.payer.id ||
                currentUser.id === txn.trip?.group?.ownerId
            )
        );
    }, [currentUser]);

    const saveEdit = async (txnId: string) => {
        if (!editTitle.trim() || !parseFloat(editAmount)) return;
        // Block editing custom split transactions (amounts can't be recalculated)
        const editingTxn = transactions.find(t => t.id === txnId);
        if (!editingTxn || !canSaveTransaction(editingTxn)) {
            toast('Only the payer or group owner can edit this expense.', 'error');
            return;
        }
        if (editingTxn?.splitType === 'custom') {
            toast('Cannot edit custom split transactions. Delete and add a new one with updated amounts.', 'error');
            return;
        }
        setSavingEdit(true);
        try {
            const res = await fetch(`/api/transactions/${txnId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: editTitle.trim(),
                    amount: Math.round(parseFloat(editAmount) * 100),
                    splitAmong: Array.from(editSplitAmong),
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
        setDeleteConfirmId(null);
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

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const params = new URLSearchParams(window.location.search);
        setFocusId(params.get('focus'));
    }, []);

    useEffect(() => {
        if (!focusId || transactions.length === 0 || editingId === focusId) return;

        const focusedTransaction = transactions.find((transaction) => transaction.id === focusId);
        if (focusedTransaction) {
            startEdit(focusedTransaction);
        }
    }, [editingId, focusId, transactions]);

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
                            <div style={{ width: 44, height: 44, borderRadius: 'var(--radius-xl)', background: 'rgba(var(--accent-500-rgb), 0.06)' }} />
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

            {/* ═══ SUMMARY HERO — Glassmorphic Stats Card ═══ */}
            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.5, delay: 0.05 }}
            >
                <div style={{
                    ...glass, borderRadius: 'var(--radius-2xl)', padding: 'var(--space-5)',
                    background: 'linear-gradient(135deg, rgba(var(--accent-500-rgb), 0.08), var(--bg-glass), rgba(var(--accent-500-rgb), 0.04))',
                    boxShadow: 'var(--shadow-card), 0 0 30px rgba(var(--accent-500-rgb), 0.06)',
                }}>
                    {/* Top light edge */}
                    <div style={{
                        position: 'absolute', top: 0, left: '15%', right: '15%', height: 1,
                        background: 'linear-gradient(90deg, transparent, rgba(var(--accent-500-rgb), 0.15), transparent)',
                        pointerEvents: 'none',
                    }} />
                    <div style={{ position: 'relative', zIndex: 1, textAlign: 'center' }}>
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)', fontWeight: 600, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                            Total Spent
                        </div>
                        <div style={{
                            fontSize: 'var(--text-2xl)', fontWeight: 800,
                            background: 'linear-gradient(135deg, var(--accent-400), var(--accent-600))',
                            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
                        }}>
                            {formatCurrency(totalSpent)}
                        </div>
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-muted)', marginTop: 4 }}>
                            {filtered.length} transaction{filtered.length !== 1 ? 's' : ''}
                        </div>
                    </div>

                    {/* Quick Action Row */}
                    <div style={{
                        display: 'flex', gap: 'var(--space-2)', justifyContent: 'center',
                        marginTop: 'var(--space-4)', paddingTop: 'var(--space-3)',
                        borderTop: '1px solid rgba(var(--accent-500-rgb), 0.06)',
                    }}>
                        <button
                            onClick={() => router.push('/transactions/scan')}
                            style={{
                                display: 'flex', alignItems: 'center', gap: 6,
                                padding: '8px 16px', borderRadius: 'var(--radius-full)',
                                background: 'rgba(var(--accent-500-rgb), 0.06)',
                                border: '1px solid rgba(var(--accent-500-rgb), 0.1)',
                                color: 'var(--fg-secondary)', fontSize: 'var(--text-xs)', fontWeight: 600,
                                cursor: 'pointer', transition: 'all 0.2s',
                            }}
                        >
                            <ScanLine size={13} /> Scan
                        </button>
                        <button
                            onClick={() => router.push('/transactions/new')}
                            style={{
                                display: 'flex', alignItems: 'center', gap: 6,
                                padding: '8px 16px', borderRadius: 'var(--radius-full)',
                                background: 'linear-gradient(135deg, var(--accent-500), var(--accent-600))',
                                border: 'none', color: 'white', fontSize: 'var(--text-xs)', fontWeight: 700,
                                cursor: 'pointer', boxShadow: '0 4px 16px rgba(var(--accent-500-rgb), 0.3)',
                                transition: 'all 0.2s',
                            }}
                        >
                            <Plus size={13} /> Add Expense
                        </button>
                    </div>
                </div>
            </motion.div>

            {/* ═══ SEARCH + CONTROLS ═══ */}
            <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.08 }}
            >
                <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
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
                        title={`Sort by ${sortBy === 'time' ? 'amount' : 'time'}`}
                        style={{
                            width: 42, height: 42, borderRadius: 'var(--radius-xl)',
                            ...glass, display: 'flex', alignItems: 'center', justifyContent: 'center',
                            cursor: 'pointer', color: sortBy === 'amount' ? 'var(--accent-400)' : 'var(--fg-tertiary)',
                            transition: 'all 0.2s',
                        }}
                    >
                        <ArrowUpDown size={15} />
                    </button>
                    <button
                        onClick={() => setViewMode(viewMode === 'list' ? 'timeline' : 'list')}
                        title={`Switch to ${viewMode === 'list' ? 'timeline' : 'list'} view`}
                        style={{
                            width: 42, height: 42, borderRadius: 'var(--radius-xl)',
                            ...glass, display: 'flex', alignItems: 'center', justifyContent: 'center',
                            cursor: 'pointer', color: viewMode === 'timeline' ? 'var(--accent-400)' : 'var(--fg-tertiary)',
                            transition: 'all 0.2s',
                        }}
                    >
                        {viewMode === 'list' ? <Clock size={15} /> : <List size={15} />}
                    </button>
                </div>
            </motion.div>

            {/* ═══ CATEGORY FILTER PILLS ═══ */}
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.4, delay: 0.12 }}
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

            {/* ═══ TRANSACTION LIST — Premium Cards ═══ */}
            {viewMode === 'list' ? (
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
                                        borderRadius: 'var(--radius-xl)',
                                        padding: 'var(--space-3) var(--space-4)',
                                        cursor: editingId === txn.id ? 'default' : 'pointer',
                                        transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
                                    }}
                                        onMouseEnter={(e) => {
                                            if (editingId !== txn.id) {
                                                e.currentTarget.style.transform = 'translateY(-1px)';
                                                e.currentTarget.style.boxShadow = 'var(--shadow-card-hover), 0 0 20px rgba(var(--accent-500-rgb), 0.04)';
                                            }
                                        }}
                                        onMouseLeave={(e) => {
                                            e.currentTarget.style.transform = 'translateY(0)';
                                            e.currentTarget.style.boxShadow = '';
                                        }}
                                    >
                                        {editingId === txn.id ? (
                                            /* Inline edit/view mode */
                                            (() => {
                                                const isReadOnlyView = !canSaveTransaction(txn);
                                                const amountReadOnly = isReadOnlyView || txn.splitType === 'custom';

                                                return <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                                                    <span style={{ fontSize: 12, color: 'var(--fg-tertiary)', fontWeight: 600 }}>
                                                        {isReadOnlyView ? 'Viewing split details' : 'Edit transaction'}
                                                    </span>
                                                    {isReadOnlyView && (
                                                        <span style={{
                                                            padding: '3px 8px',
                                                            borderRadius: 999,
                                                            fontSize: 10,
                                                            fontWeight: 700,
                                                            letterSpacing: '0.03em',
                                                            textTransform: 'uppercase',
                                                            background: 'rgba(var(--accent-500-rgb), 0.1)',
                                                            color: 'var(--accent-400)',
                                                        }}>
                                                            Read only
                                                        </span>
                                                    )}
                                                </div>
                                                <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} readOnly={isReadOnlyView}
                                                    style={{ background: isReadOnlyView ? 'var(--surface-sunken)' : 'var(--surface-input)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-lg)', padding: '10px 14px', color: isReadOnlyView ? 'var(--fg-tertiary)' : 'var(--fg-primary)', fontSize: 'var(--text-sm)', outline: 'none', width: '100%', cursor: isReadOnlyView ? 'default' : 'text', opacity: isReadOnlyView ? 0.8 : 1 }}
                                                    placeholder="Title" />
                                                <input value={editAmount} onChange={(e) => setEditAmount(e.target.value)} type="number" step="0.01"
                                                    readOnly={amountReadOnly}
                                                    style={{
                                                        background: amountReadOnly ? 'var(--surface-sunken)' : 'var(--surface-input)',
                                                        border: '1px solid var(--border-default)', borderRadius: 'var(--radius-lg)',
                                                        padding: '10px 14px', color: amountReadOnly ? 'var(--fg-tertiary)' : 'var(--fg-primary)',
                                                        fontSize: 'var(--text-sm)', outline: 'none', width: '100%',
                                                        cursor: amountReadOnly ? 'not-allowed' : 'text',
                                                        opacity: amountReadOnly ? 0.7 : 1,
                                                    }}
                                                    placeholder="Amount (₹)" />
                                                {isReadOnlyView && (
                                                    <p style={{ fontSize: 11, color: 'var(--fg-tertiary)', fontWeight: 500, textAlign: 'center', marginTop: 4 }}>
                                                        Read only: only the payer or group owner can edit this expense.
                                                    </p>
                                                )}
                                                {txn.splitType === 'custom' && (
                                                    <p style={{ fontSize: 11, color: isReadOnlyView ? 'var(--fg-tertiary)' : '#eab308', fontWeight: 500, textAlign: 'center', marginTop: 4 }}>
                                                        ⚠ Custom split edit amount can&apos;t be edited.
                                                    </p>
                                                )}

                                                {/* Member Split Display with Amounts */}
                                                {txn.trip?.group.members && (
                                                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center', marginTop: 8, marginBottom: 8 }}>
                                                        <div style={{ width: '100%', textAlign: 'center', fontSize: '11px', color: 'var(--fg-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                                                            <span>Split between</span>
                                                            <span style={{
                                                                padding: '2px 8px', borderRadius: 8,
                                                                background: txn.splitType === 'custom' ? 'rgba(234, 179, 8, 0.12)' : 'rgba(var(--accent-500-rgb), 0.1)',
                                                                color: txn.splitType === 'custom' ? '#eab308' : 'var(--accent-400)',
                                                                fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em',
                                                            }}>
                                                                {txn.splitType === 'custom' ? 'Custom' : 'Equal'}
                                                            </span>
                                                        </div>
                                                        {(() => {
                                                            const isCustom = txn.splitType === 'custom';
                                                            const editAmountPaise = Math.round(parseFloat(editAmount || '0') * 100);
                                                            const selectedCount = editSplitAmong.size;
                                                            const perPersonEqual = selectedCount > 0 ? Math.floor(editAmountPaise / selectedCount) : 0;
                                                            const remainderEqual = selectedCount > 0 ? editAmountPaise - perPersonEqual * selectedCount : 0;
                                                            const selectedArr = Array.from(editSplitAmong);

                                                            return txn.trip!.group.members.map(m => {
                                                                const isSelected = editSplitAmong.has(m.userId);
                                                                const splitEntry = txn.splits.find(s => s.userId === m.userId);

                                                                // Determine the display amount
                                                                let displayAmount: number | null = null;
                                                                if (isCustom && splitEntry) {
                                                                    displayAmount = splitEntry.amount;
                                                                } else if (!isCustom && isSelected) {
                                                                    const idx = selectedArr.indexOf(m.userId);
                                                                    displayAmount = perPersonEqual + (idx === 0 ? remainderEqual : 0);
                                                                }

                                                                return (
                                                                    <button
                                                                        key={m.userId}
                                                                        onClick={() => {
                                                                            if (isCustom || isReadOnlyView) return; // Don't allow toggling custom splits or read-only views
                                                                            const next = new Set(editSplitAmong);
                                                                            if (next.has(m.userId)) next.delete(m.userId);
                                                                            else next.add(m.userId);
                                                                            setEditSplitAmong(next);
                                                                        }}
                                                                        style={{
                                                                            padding: '6px 12px', borderRadius: 16,
                                                                            border: `1px solid ${isSelected ? 'var(--accent-500)' : 'var(--border-default)'}`,
                                                                            background: isSelected ? 'var(--accent-500)' : 'var(--bg-primary)',
                                                                            color: isSelected ? 'white' : 'var(--fg-secondary)',
                                                                            fontSize: '12px', fontWeight: 500,
                                                                            cursor: (isCustom || isReadOnlyView) ? 'default' : 'pointer',
                                                                            opacity: (!isCustom && !isSelected) ? 0.5 : 1,
                                                                            transition: 'all 0.2s',
                                                                            display: 'flex', alignItems: 'center', gap: 4,
                                                                        }}
                                                                    >
                                                                        {m.user.name?.split(' ')[0] || 'Unknown'}
                                                                        {displayAmount !== null && (
                                                                            <span style={{
                                                                                fontSize: '10px',
                                                                                fontWeight: 700,
                                                                                opacity: 0.85,
                                                                                borderLeft: `1px solid ${isSelected ? 'rgba(255,255,255,0.3)' : 'var(--border-default)'}`,
                                                                                paddingLeft: 5,
                                                                                marginLeft: 2,
                                                                            }}>
                                                                                ₹{(displayAmount / 100).toLocaleString('en-IN')}
                                                                            </span>
                                                                        )}
                                                                    </button>
                                                                );
                                                            });
                                                        })()}
                                                    </div>
                                                )}

                                                <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
                                                    <button onClick={() => setEditingId(null)} style={{ padding: '7px 14px', borderRadius: 'var(--radius-full)', background: 'var(--bg-glass)', border: '1px solid var(--border-glass)', color: 'var(--fg-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: '12px', fontWeight: 600 }}>
                                                        <X size={13} /> {isReadOnlyView ? 'Close' : 'Cancel'}
                                                    </button>
                                                    {canSaveTransaction(txn) && (
                                                        <button onClick={() => saveEdit(txn.id)} disabled={savingEdit} style={{ padding: '7px 14px', borderRadius: 'var(--radius-full)', background: 'linear-gradient(135deg, var(--accent-500), var(--accent-600))', border: 'none', color: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: '12px', fontWeight: 600, opacity: savingEdit ? 0.6 : 1 }}>
                                                            <Check size={13} /> Save
                                                        </button>
                                                    )}
                                                </div>
                                            </div>;
                                            })()
                                        ) : (
                                            <div style={{
                                                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                                gap: 12, padding: 4
                                            }}>
                                                {/* Left Section: Icon and Details */}
                                                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, flex: 1, minWidth: 0 }}>
                                                    {/* Category Icon */}
                                                    <div style={{
                                                        width: 44, height: 44, borderRadius: 14,
                                                        background: `linear-gradient(135deg, ${catConfig.color}15, ${catConfig.color}05)`,
                                                        border: `1px solid ${catConfig.color}1A`,
                                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                        flexShrink: 0, color: catConfig.color, marginTop: 2,
                                                    }}>
                                                        <CategoryIcon category={txn.category} size={22} />
                                                    </div>

                                                    {/* Text Content */}
                                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, flex: 1, minWidth: 0 }}>
                                                        <div style={{
                                                            fontSize: 16, fontWeight: 700,
                                                            color: 'var(--fg-primary)', letterSpacing: '-0.3px',
                                                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                                        }}>
                                                            {txn.title}
                                                        </div>
                                                        <div style={{
                                                            fontSize: 13, color: 'var(--fg-tertiary)', fontWeight: 500,
                                                            display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'center',
                                                            flexWrap: 'nowrap', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                                                        }}>
                                                            <span>Paid by {payerName.split(' ')[0]}</span>
                                                            <span style={{ width: 3, height: 3, borderRadius: '50%', background: 'var(--border-strong)' }} />
                                                            <span>{timeAgo(txn.createdAt)}</span>
                                                        </div>
                                                        {txn.method && (
                                                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, marginTop: 4 }}>
                                                                <div style={{
                                                                    display: 'inline-flex', alignItems: 'center', gap: 4,
                                                                    background: 'var(--surface-sunken)', padding: '3px 8px',
                                                                    borderRadius: 6, fontSize: 11, fontWeight: 600,
                                                                    color: 'var(--fg-secondary)', border: '1px solid var(--border-subtle)',
                                                                }}>
                                                                    <PaymentIcon method={txn.method} size={12} />
                                                                    <span>{metConfig.label}</span>
                                                                </div>
                                                                {txn.splits?.length > 1 && (
                                                                    <div style={{
                                                                        display: 'inline-flex', alignItems: 'center', gap: 4,
                                                                        background: 'var(--surface-sunken)', padding: '3px 8px',
                                                                        borderRadius: 6, fontSize: 11, fontWeight: 600,
                                                                        color: 'var(--fg-secondary)', border: '1px solid var(--border-subtle)',
                                                                    }}>
                                                                        <Users size={12} opacity={0.7} />
                                                                        <span>Split with {txn.splits.length}</span>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>

                                                {/* Right Section: Amount and Actions */}
                                                {(() => {
                                                    const canViewSplitDetails = Boolean(currentUser);
                                                    const canEdit = canSaveTransaction(txn);
                                                    return (
                                                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 10, flexShrink: 0 }}>
                                                            <div style={{
                                                                fontWeight: 800, fontSize: 18,
                                                                color: 'var(--fg-primary)', letterSpacing: '-0.5px',
                                                            }}>
                                                                {formatCurrency(txn.amount)}
                                                            </div>

                                                            {canViewSplitDetails ? (
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                                    <button
                                                                        onClick={(e) => { e.stopPropagation(); startEdit(txn); }}
                                                                        style={{
                                                                            cursor: 'pointer',
                                                                            background: 'var(--surface-card)',
                                                                            color: 'var(--fg-secondary)',
                                                                            padding: '6px', borderRadius: 8,
                                                                            boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                                                                            border: '1px solid var(--border-subtle)',
                                                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                                            transition: 'all 0.2s ease',
                                                                        }}
                                                                        onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-500)'; e.currentTarget.style.borderColor = 'var(--accent-300)'; }}
                                                                        onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--fg-secondary)'; e.currentTarget.style.borderColor = 'var(--border-subtle)'; }}
                                                                        title={canEdit ? 'Edit transaction' : 'View split details'}
                                                                    >
                                                                        <Pencil size={14} />
                                                                    </button>
                                                                    {canEdit && (
                                                                        <button
                                                                            onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(txn.id); }}
                                                                            disabled={deletingId === txn.id}
                                                                            style={{
                                                                                cursor: 'pointer',
                                                                                background: 'var(--surface-card)',
                                                                                color: 'var(--fg-secondary)',
                                                                                padding: '6px', borderRadius: 8,
                                                                                boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                                                                                border: '1px solid var(--border-subtle)',
                                                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                                                transition: 'all 0.2s ease',
                                                                                opacity: deletingId === txn.id ? 0.3 : 1,
                                                                            }}
                                                                            onMouseEnter={(e) => { e.currentTarget.style.color = '#ef4444'; e.currentTarget.style.borderColor = '#fca5a5'; }}
                                                                            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--fg-secondary)'; e.currentTarget.style.borderColor = 'var(--border-subtle)'; }}
                                                                            title="Delete"
                                                                        >
                                                                            <Trash2 size={14} />
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            ) : null}
                                                        </div>
                                                    );
                                                })()}
                                            </div>
                                        )}
                                    </div>
                                </motion.div>
                            );
                        })}
                    </AnimatePresence>
                </div>
            ) : (
                /* ═══ TIMELINE VIEW — Vertical timeline with day headers ═══ */
                <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                    {(() => {
                        // Group by day
                        const grouped: Record<string, TransactionData[]> = {};
                        filtered.forEach(txn => {
                            const day = new Date(txn.createdAt).toLocaleDateString('en-IN', {
                                weekday: 'short', day: 'numeric', month: 'short'
                            });
                            if (!grouped[day]) grouped[day] = [];
                            grouped[day].push(txn);
                        });

                        let itemIdx = 0;
                        return Object.entries(grouped).map(([day, txns]) => (
                            <div key={day}>
                                {/* Date header */}
                                <motion.div
                                    initial={{ opacity: 0, x: -10 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    style={{
                                        fontSize: 'var(--text-xs)', fontWeight: 700,
                                        color: 'var(--accent-400)',
                                        padding: 'var(--space-3) 0 var(--space-1) var(--space-6)',
                                        textTransform: 'uppercase', letterSpacing: '0.05em',
                                    }}
                                >
                                    {day}
                                </motion.div>
                                {txns.map(txn => {
                                    const catConfig = CATEGORY_ICONS[txn.category] || CATEGORY_ICONS.general;
                                    const idx = itemIdx++;
                                    return (
                                        <motion.div
                                            key={txn.id}
                                            initial={{ opacity: 0, y: 12 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            transition={{ delay: Math.min(idx * 0.04, 0.5), duration: 0.35 }}
                                            style={{
                                                display: 'flex', gap: 'var(--space-3)',
                                                padding: 'var(--space-1) 0',
                                            }}
                                        >
                                            {/* Timeline bar */}
                                            <div style={{
                                                display: 'flex', flexDirection: 'column',
                                                alignItems: 'center', width: 20, flexShrink: 0,
                                            }}>
                                                <div style={{
                                                    width: 10, height: 10, borderRadius: '50%',
                                                    background: `linear-gradient(135deg, var(--accent-400), var(--accent-600))`,
                                                    border: '2px solid var(--bg-primary)',
                                                    boxShadow: '0 0 8px rgba(var(--accent-500-rgb), 0.3)',
                                                    flexShrink: 0,
                                                }} />
                                                <div style={{
                                                    width: 2, flex: 1, minHeight: 24,
                                                    background: 'linear-gradient(to bottom, rgba(var(--accent-500-rgb), 0.2), rgba(var(--accent-500-rgb), 0.05))',
                                                }} />
                                            </div>
                                            {/* Card */}
                                            <div style={{
                                                ...glass, flex: 1,
                                                padding: 'var(--space-3)',
                                                marginBottom: 'var(--space-2)',
                                            }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                                                    <div style={{
                                                        width: 32, height: 32, borderRadius: 'var(--radius-lg)',
                                                        background: `${catConfig.color}11`,
                                                        border: `1px solid ${catConfig.color}10`,
                                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                        flexShrink: 0,
                                                    }}>
                                                        <CategoryIcon category={txn.category} size={14} />
                                                    </div>
                                                    <div style={{ flex: 1, minWidth: 0 }}>
                                                        <div style={{
                                                            fontWeight: 700, fontSize: 'var(--text-sm)',
                                                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                                        }}>
                                                            {txn.title}
                                                        </div>
                                                        <div style={{ fontSize: '10px', color: 'var(--fg-tertiary)', marginTop: 1 }}>
                                                            {(txn.payer.name || 'Unknown').split(' ')[0]} · {new Date(txn.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                                                        </div>
                                                    </div>
                                                    <span style={{
                                                        fontWeight: 800, fontSize: 'var(--text-sm)',
                                                        background: 'linear-gradient(135deg, var(--accent-400), var(--accent-500))',
                                                        WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
                                                        fontFeatureSettings: "'tnum'",
                                                    }}>
                                                        {formatCurrency(txn.amount)}
                                                    </span>
                                                </div>
                                            </div>
                                        </motion.div>
                                    );
                                })}
                            </div>
                        ));
                    })()}
                </div>
            )}

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
                                width: 60, height: 60, borderRadius: 'var(--radius-2xl)',
                                background: 'rgba(var(--accent-500-rgb), 0.08)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                margin: '0 auto var(--space-3)', color: 'var(--accent-400)',
                            }}>
                                <Inbox size={28} />
                            </div>
                            <div style={{ fontWeight: 700, color: 'var(--fg-primary)', marginBottom: 4, fontSize: 'var(--text-base)' }}>
                                No transactions found
                            </div>
                            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)', maxWidth: 240, margin: '0 auto' }}>
                                {search || filterCategory ? 'Try adjusting your search or filters' : 'Add your first expense to get started'}
                            </div>
                            {!search && !filterCategory && (
                                <Button
                                    size="sm"
                                    leftIcon={<Plus size={14} />}
                                    onClick={() => router.push('/transactions/new')}
                                    style={{
                                        marginTop: 'var(--space-4)',
                                        background: 'linear-gradient(135deg, var(--accent-500), var(--accent-600))',
                                        boxShadow: '0 4px 20px rgba(var(--accent-500-rgb), 0.3)',
                                    }}
                                >
                                    Add Expense
                                </Button>
                            )}
                        </div>
                    </div>
                </motion.div>
            )}

            {/* ── Delete Confirmation Modal (Portal to body for correct viewport centering) ── */}
            {typeof document !== 'undefined' && createPortal(
                <AnimatePresence>
                    {deleteConfirmId && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.2 }}
                            onClick={() => setDeleteConfirmId(null)}
                            style={{
                                position: 'fixed', inset: 0, zIndex: 9999,
                                background: 'transparent',
                                backdropFilter: 'blur(8px)',
                                WebkitBackdropFilter: 'blur(8px)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                padding: 20,
                            }}
                        >
                            <motion.div
                                initial={{ opacity: 0, scale: 0.85, y: 30 }}
                                animate={{ opacity: 1, scale: 1, y: 0 }}
                                exit={{ opacity: 0, scale: 0.85, y: 30 }}
                                transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                                onClick={(e) => e.stopPropagation()}
                                style={{
                                    width: '100%', maxWidth: 340,
                                    background: 'var(--bg-elevated)',
                                    border: '1px solid var(--border-glass)',
                                    borderRadius: 24, padding: 28,
                                    boxShadow: '0 24px 64px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.05)',
                                    textAlign: 'center',
                                }}
                            >
                                {/* Icon */}
                                <div style={{
                                    width: 56, height: 56, borderRadius: 16, margin: '0 auto 16px',
                                    background: 'linear-gradient(135deg, #ef4444, #dc2626)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    boxShadow: '0 8px 24px rgba(239, 68, 68, 0.3)',
                                }}>
                                    <Trash2 size={24} color="#fff" />
                                </div>

                                <h3 style={{
                                    fontSize: 18, fontWeight: 700, color: 'var(--fg-primary)', marginBottom: 8,
                                }}>
                                    Delete Expense?
                                </h3>
                                <p style={{
                                    fontSize: 13.5, color: 'var(--fg-secondary)', lineHeight: 1.6, marginBottom: 24,
                                }}>
                                    This will permanently remove the expense and all its splits. This action cannot be undone.
                                </p>

                                {/* Buttons */}
                                <div style={{ display: 'flex', gap: 10 }}>
                                    <button
                                        onClick={() => setDeleteConfirmId(null)}
                                        style={{
                                            flex: 1, padding: '12px 0', borderRadius: 14,
                                            border: '1px solid var(--border-glass)',
                                            background: 'var(--surface-card)', color: 'var(--fg-primary)',
                                            fontSize: 14, fontWeight: 600, cursor: 'pointer',
                                            transition: 'all 0.2s',
                                        }}
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={() => handleDelete(deleteConfirmId)}
                                        style={{
                                            flex: 1, padding: '12px 0', borderRadius: 14,
                                            border: 'none',
                                            background: 'linear-gradient(135deg, #ef4444, #dc2626)',
                                            color: '#fff',
                                            fontSize: 14, fontWeight: 600, cursor: 'pointer',
                                            boxShadow: '0 4px 16px rgba(239, 68, 68, 0.3)',
                                            transition: 'all 0.2s',
                                        }}
                                    >
                                        Delete
                                    </button>
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
