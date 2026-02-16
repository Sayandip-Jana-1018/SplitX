'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    ArrowLeft, Users, Receipt, TrendingUp, TrendingDown,
    Copy, Share2, Plus, Pencil, Trash2, Check, X,
    Calendar, CreditCard
} from 'lucide-react';
import { useRouter, useParams } from 'next/navigation';
import { useToast } from '@/components/ui/Toast';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useHaptics } from '@/hooks/useHaptics';
import { formatCurrency, timeAgo, CATEGORIES } from '@/lib/utils';

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

interface Member {
    id: string;
    userId: string;
    role: string;
    user: { id: string; name: string | null; email: string | null; image: string | null };
}

interface Transaction {
    id: string;
    title: string;
    amount: number;
    category: string;
    method: string;
    date: string;
    createdAt: string;
    payer: { id: string; name: string | null };
    splits: { userId: string; amount: number; user: { id: string; name: string | null } }[];
}

interface Trip {
    id: string;
    title: string;
    isActive: boolean;
    transactions: Transaction[];
    settlements: { id: string; amount: number; status: string; from: { id: string; name: string | null }; to: { id: string; name: string | null } }[];
}

interface GroupDetail {
    id: string;
    name: string;
    emoji: string;
    inviteCode: string;
    ownerId: string;
    members: Member[];
    trips: Trip[];
    totalSpent: number;
    balances: Record<string, number>;
    currentUserId: string;
    activeTrip: Trip | null;
}

const fadeUp = { initial: { opacity: 0, y: 16 }, animate: { opacity: 1, y: 0 } };

export default function GroupDetailPage() {
    const router = useRouter();
    const params = useParams();
    const groupId = params.id as string;
    const { toast } = useToast();
    const haptics = useHaptics();
    const { user: currentUser } = useCurrentUser();

    const [group, setGroup] = useState<GroupDetail | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    const [editingTxn, setEditingTxn] = useState<string | null>(null);
    const [editTitle, setEditTitle] = useState('');
    const [editAmount, setEditAmount] = useState('');
    const [savingEdit, setSavingEdit] = useState(false);

    const fetchGroup = async () => {
        setLoading(true); setError(false);
        try {
            const res = await fetch(`/api/groups/${groupId}`);
            if (res.ok) {
                setGroup(await res.json());
            } else setError(true);
        } catch { setError(true); }
        finally { setLoading(false); }
    };

    useEffect(() => { fetchGroup(); }, [groupId]);

    const copyInviteCode = () => {
        if (!group) return;
        const url = `${window.location.origin}/join/${group.inviteCode}`;
        navigator.clipboard.writeText(url);
        haptics.light();
        toast('Invite link copied!', 'success');
    };

    const shareGroup = async () => {
        if (!group) return;
        const url = `${window.location.origin}/join/${group.inviteCode}`;
        if (navigator.share) {
            try {
                await navigator.share({ title: `Join ${group.name}`, text: `Join our expense group!`, url });
            } catch { /* cancelled */ }
        } else {
            copyInviteCode();
        }
    };

    const startEdit = (txn: Transaction) => {
        setEditingTxn(txn.id);
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
                setEditingTxn(null);
                fetchGroup();
            } else {
                toast('Failed to update', 'error');
            }
        } catch { toast('Network error', 'error'); }
        finally { setSavingEdit(false); }
    };

    const deleteTxn = async (txnId: string) => {
        try {
            const res = await fetch(`/api/transactions/${txnId}`, { method: 'DELETE' });
            if (res.ok) {
                toast('Transaction deleted', 'success');
                fetchGroup();
            } else toast('Failed to delete', 'error');
        } catch { toast('Network error', 'error'); }
    };

    if (loading) {
        return (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
                <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}>
                    <CreditCard size={28} style={{ color: 'var(--accent-400)' }} />
                </motion.div>
            </div>
        );
    }

    if (error || !group) {
        return (
            <div style={{ textAlign: 'center', padding: 'var(--space-8)', color: 'var(--fg-tertiary)' }}>
                <p>Failed to load group.</p>
                <button onClick={fetchGroup} style={{
                    marginTop: 'var(--space-3)', padding: '8px 16px', borderRadius: 'var(--radius-full)',
                    background: 'var(--accent-500)', color: 'white', border: 'none', cursor: 'pointer',
                }}>Retry</button>
            </div>
        );
    }

    const allTransactions = group.trips.flatMap(t => t.transactions);
    const isOwner = group.currentUserId === group.ownerId;

    return (
        <motion.div
            style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}
            initial="initial" animate="animate"
            transition={{ staggerChildren: 0.06 }}
        >
            {/* ═══ HEADER ═══ */}
            <motion.div variants={fadeUp}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
                    <button onClick={() => router.push('/groups')} style={{
                        background: 'var(--bg-glass)', backdropFilter: 'blur(16px)',
                        border: '1px solid var(--border-glass)', borderRadius: 'var(--radius-full)',
                        width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        cursor: 'pointer', color: 'var(--fg-secondary)',
                    }}>
                        <ArrowLeft size={18} />
                    </button>
                    <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                            <span style={{ fontSize: '1.5rem' }}>{group.emoji}</span>
                            <h1 style={{
                                fontSize: 'var(--text-xl)', fontWeight: 800, color: 'var(--fg-primary)',
                                margin: 0,
                            }}>
                                {group.name}
                            </h1>
                        </div>
                        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)', margin: 0, marginTop: 2 }}>
                            {group.members.length} member{group.members.length !== 1 ? 's' : ''} · {allTransactions.length} expense{allTransactions.length !== 1 ? 's' : ''}
                        </p>
                    </div>
                    <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                        <button onClick={copyInviteCode} style={{
                            background: 'var(--bg-glass)', backdropFilter: 'blur(16px)',
                            border: '1px solid var(--border-glass)', borderRadius: 'var(--radius-full)',
                            width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center',
                            cursor: 'pointer', color: 'var(--fg-secondary)',
                        }}>
                            <Copy size={15} />
                        </button>
                        <button onClick={shareGroup} style={{
                            background: 'var(--bg-glass)', backdropFilter: 'blur(16px)',
                            border: '1px solid var(--border-glass)', borderRadius: 'var(--radius-full)',
                            width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center',
                            cursor: 'pointer', color: 'var(--fg-secondary)',
                        }}>
                            <Share2 size={15} />
                        </button>
                    </div>
                </div>
            </motion.div>

            {/* ═══ TOTAL SPENT CARD ═══ */}
            <motion.div variants={fadeUp} style={{ ...glass, padding: 'var(--space-5)' }}>
                <div style={{
                    position: 'absolute', inset: 0,
                    background: 'linear-gradient(135deg, rgba(var(--accent-500-rgb), 0.06), transparent 60%)',
                    pointerEvents: 'none',
                }} />
                <div style={{ position: 'relative' }}>
                    <div style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--fg-tertiary)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        Total Group Spending
                    </div>
                    <div style={{
                        fontSize: '2rem', fontWeight: 900,
                        background: 'linear-gradient(135deg, var(--accent-400), var(--accent-500))',
                        WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
                        lineHeight: 1.2,
                    }}>
                        {formatCurrency(group.totalSpent)}
                    </div>
                </div>
            </motion.div>

            {/* ═══ MEMBER BALANCES ═══ */}
            <motion.div variants={fadeUp}>
                <h2 style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--fg-primary)', marginBottom: 'var(--space-3)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Users size={15} style={{ color: 'var(--accent-400)' }} /> Members & Balances
                </h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                    {group.members.map((member) => {
                        const balance = group.balances[member.userId] || 0;
                        const isPositive = balance > 0;
                        const isZero = balance === 0;
                        return (
                            <div key={member.id} style={{
                                ...glass, padding: 'var(--space-3)',
                                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                                    <div style={{
                                        width: 36, height: 36, borderRadius: 'var(--radius-full)',
                                        background: member.userId === group.currentUserId
                                            ? 'linear-gradient(135deg, var(--accent-400), var(--accent-600))'
                                            : 'rgba(var(--accent-500-rgb), 0.1)',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        fontSize: 'var(--text-xs)', fontWeight: 700,
                                        color: member.userId === group.currentUserId ? 'white' : 'var(--accent-400)',
                                    }}>
                                        {(member.user.name || '?').charAt(0).toUpperCase()}
                                    </div>
                                    <div>
                                        <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--fg-primary)' }}>
                                            {member.user.name || 'Unknown'}
                                            {member.userId === group.currentUserId && (
                                                <span style={{ fontSize: '10px', color: 'var(--accent-400)', marginLeft: 4 }}>(You)</span>
                                            )}
                                        </div>
                                        <div style={{ fontSize: '10px', color: 'var(--fg-tertiary)' }}>
                                            {member.role === 'admin' || member.userId === group.ownerId ? 'Admin' : 'Member'}
                                        </div>
                                    </div>
                                </div>
                                <div style={{
                                    display: 'flex', alignItems: 'center', gap: 4,
                                    fontSize: 'var(--text-sm)', fontWeight: 700,
                                    color: isZero ? 'var(--fg-tertiary)' : isPositive ? 'var(--color-success)' : 'var(--color-error)',
                                }}>
                                    {!isZero && (isPositive ? <TrendingUp size={13} /> : <TrendingDown size={13} />)}
                                    {isZero ? 'Settled' : formatCurrency(Math.abs(balance))}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </motion.div>

            {/* ═══ RECENT EXPENSES ═══ */}
            <motion.div variants={fadeUp}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-3)' }}>
                    <h2 style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--fg-primary)', display: 'flex', alignItems: 'center', gap: 6, margin: 0 }}>
                        <Receipt size={15} style={{ color: 'var(--accent-400)' }} /> Expenses
                    </h2>
                    <button onClick={() => router.push(`/transactions/new?groupId=${group.id}`)} style={{
                        display: 'flex', alignItems: 'center', gap: 4,
                        padding: '6px 12px', borderRadius: 'var(--radius-full)',
                        background: 'linear-gradient(135deg, var(--accent-500), var(--accent-600))',
                        border: 'none', color: 'white', fontSize: '11px', fontWeight: 600, cursor: 'pointer',
                    }}>
                        <Plus size={13} /> Add
                    </button>
                </div>

                {allTransactions.length === 0 ? (
                    <div style={{ ...glass, padding: 'var(--space-6)', textAlign: 'center' }}>
                        <Receipt size={28} style={{ color: 'var(--fg-muted)', margin: '0 auto var(--space-2)' }} />
                        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-tertiary)' }}>
                            No expenses yet. Add one to get started!
                        </p>
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                        <AnimatePresence>
                            {allTransactions.slice(0, 20).map((txn) => {
                                const cat = CATEGORIES[txn.category];
                                const isEditing = editingTxn === txn.id;
                                const canEdit = txn.payer.id === group.currentUserId || isOwner;

                                return (
                                    <motion.div
                                        key={txn.id}
                                        layout
                                        initial={{ opacity: 0, y: 8 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, x: -50 }}
                                        style={{ ...glass, padding: 'var(--space-3)' }}
                                    >
                                        {isEditing ? (
                                            /* Edit mode */
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                                                <input
                                                    value={editTitle}
                                                    onChange={(e) => setEditTitle(e.target.value)}
                                                    style={{
                                                        background: 'var(--surface-input)', border: '1px solid var(--border-default)',
                                                        borderRadius: 'var(--radius-lg)', padding: '8px 12px',
                                                        color: 'var(--fg-primary)', fontSize: 'var(--text-sm)',
                                                        outline: 'none', width: '100%',
                                                    }}
                                                    placeholder="Title"
                                                />
                                                <input
                                                    value={editAmount}
                                                    onChange={(e) => setEditAmount(e.target.value)}
                                                    type="number"
                                                    step="0.01"
                                                    style={{
                                                        background: 'var(--surface-input)', border: '1px solid var(--border-default)',
                                                        borderRadius: 'var(--radius-lg)', padding: '8px 12px',
                                                        color: 'var(--fg-primary)', fontSize: 'var(--text-sm)',
                                                        outline: 'none', width: '100%',
                                                    }}
                                                    placeholder="Amount (₹)"
                                                />
                                                <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
                                                    <button onClick={() => setEditingTxn(null)} style={{
                                                        padding: '6px 12px', borderRadius: 'var(--radius-full)',
                                                        background: 'var(--bg-glass)', border: '1px solid var(--border-glass)',
                                                        color: 'var(--fg-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: '12px',
                                                    }}>
                                                        <X size={13} /> Cancel
                                                    </button>
                                                    <button onClick={() => saveEdit(txn.id)} disabled={savingEdit} style={{
                                                        padding: '6px 12px', borderRadius: 'var(--radius-full)',
                                                        background: 'var(--accent-500)', border: 'none',
                                                        color: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: '12px',
                                                        opacity: savingEdit ? 0.6 : 1,
                                                    }}>
                                                        <Check size={13} /> Save
                                                    </button>
                                                </div>
                                            </div>
                                        ) : (
                                            /* View mode */
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                                                <div style={{
                                                    width: 36, height: 36, borderRadius: 'var(--radius-lg)',
                                                    background: 'rgba(var(--accent-500-rgb), 0.1)',
                                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                    fontSize: '16px', flexShrink: 0,
                                                }}>
                                                    {cat?.emoji || '💰'}
                                                </div>
                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                    <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--fg-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                        {txn.title}
                                                    </div>
                                                    <div style={{ fontSize: '10px', color: 'var(--fg-tertiary)', display: 'flex', alignItems: 'center', gap: 4 }}>
                                                        <Calendar size={10} /> {timeAgo(txn.createdAt)} · Paid by {txn.payer.name || 'Unknown'}
                                                    </div>
                                                </div>
                                                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                                                    <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--fg-primary)' }}>
                                                        {formatCurrency(txn.amount)}
                                                    </div>
                                                </div>
                                                {canEdit && (
                                                    <div style={{ display: 'flex', gap: 4, marginLeft: 'var(--space-1)' }}>
                                                        <button onClick={() => startEdit(txn)} style={{
                                                            background: 'none', border: 'none', cursor: 'pointer', padding: 4,
                                                            color: 'var(--fg-tertiary)',
                                                        }}>
                                                            <Pencil size={13} />
                                                        </button>
                                                        <button onClick={() => deleteTxn(txn.id)} style={{
                                                            background: 'none', border: 'none', cursor: 'pointer', padding: 4,
                                                            color: 'var(--fg-tertiary)',
                                                        }}>
                                                            <Trash2 size={13} />
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </motion.div>
                                );
                            })}
                        </AnimatePresence>
                    </div>
                )}
            </motion.div>

            {/* ═══ INVITE SECTION ═══ */}
            <motion.div variants={fadeUp} style={{ ...glass, padding: 'var(--space-4)' }}>
                <div style={{
                    position: 'absolute', inset: 0, background: 'linear-gradient(135deg, rgba(var(--accent-500-rgb), 0.04), transparent)',
                    pointerEvents: 'none',
                }} />
                <div style={{ position: 'relative' }}>
                    <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--fg-primary)', marginBottom: 'var(--space-2)' }}>
                        Invite Friends
                    </div>
                    <div style={{
                        padding: 'var(--space-2) var(--space-3)',
                        background: 'var(--surface-input)', borderRadius: 'var(--radius-lg)',
                        fontFamily: 'monospace', fontSize: 'var(--text-xs)', color: 'var(--fg-secondary)',
                        wordBreak: 'break-all', marginBottom: 'var(--space-3)',
                    }}>
                        {typeof window !== 'undefined' ? `${window.location.origin}/join/${group.inviteCode}` : `.../${group.inviteCode}`}
                    </div>
                    <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                        <button onClick={copyInviteCode} style={{
                            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                            padding: '8px 16px', borderRadius: 'var(--radius-full)',
                            background: 'rgba(var(--accent-500-rgb), 0.08)', border: '1px solid rgba(var(--accent-500-rgb), 0.12)',
                            color: 'var(--accent-400)', fontSize: 'var(--text-xs)', fontWeight: 600, cursor: 'pointer',
                        }}>
                            <Copy size={13} /> Copy Link
                        </button>
                        <button onClick={shareGroup} style={{
                            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                            padding: '8px 16px', borderRadius: 'var(--radius-full)',
                            background: 'linear-gradient(135deg, var(--accent-500), var(--accent-600))',
                            border: 'none', color: 'white', fontSize: 'var(--text-xs)', fontWeight: 600, cursor: 'pointer',
                        }}>
                            <Share2 size={13} /> Share
                        </button>
                    </div>
                </div>
            </motion.div>
        </motion.div>
    );
}
