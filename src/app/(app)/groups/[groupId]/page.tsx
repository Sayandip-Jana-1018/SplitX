'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    ArrowLeft,
    Plus,
    Users,
    ArrowRightLeft,
    Share2,
    Copy,
    Check,
    Calendar,
    TrendingUp,
    TrendingDown,
    Inbox,
    Loader2,
    Link2,
    UserMinus,
    Trash2,
    UserPlus,
    Send,
    CreditCard,
} from 'lucide-react';
import { useRouter, useParams } from 'next/navigation';
import Button from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import Avatar from '@/components/ui/Avatar';
import Badge from '@/components/ui/Badge';
import Modal from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { formatCurrency, timeAgo } from '@/lib/utils';
import { QRCodeSVG } from 'qrcode.react';
import GroupChat from '@/components/features/GroupChat';
import UpiPaymentModal from '@/components/features/UpiPaymentModal';

/* ── Types ── */
interface ContactForInvite {
    id: string;
    name: string;
    email: string;
    linkedUser: { id: string; name: string | null; image: string | null } | null;
}

/* ── Types ── */
interface MemberData {
    userId: string;
    role: string;
    nickname: string | null;
    user: { id: string; name: string | null; email: string | null; image: string | null };
}

interface TripData {
    id: string;
    title: string;
    startDate: string | null;
    endDate: string | null;
    createdAt: string;
    isActive: boolean;
    transactions: TransactionData[];
}

interface TransactionData {
    id: string;
    title: string;
    amount: number;
    category: string;
    createdAt: string;
    payer: { id: string; name: string | null };
}

interface GroupDetailData {
    id: string;
    name: string;
    emoji: string;
    inviteCode: string;
    createdAt: string;
    ownerId: string;
    members: MemberData[];
    trips: TripData[];
    activeTrip: TripData | null;
    totalSpent: number;
    balances: Record<string, number>;
    currentUserId: string;
}

/* ── Category Emojis ── */
const CATEGORY_EMOJI: Record<string, string> = {
    food: '🍕',
    transport: '🚗',
    accommodation: '🏨',
    shopping: '🛍️',
    entertainment: '🎬',
    general: '📋',
    other: '📦',
};

type Tab = 'overview' | 'members' | 'activity' | 'chat';

export default function GroupDetailPage() {
    const router = useRouter();
    const params = useParams();
    const groupId = params.groupId as string;

    const [group, setGroup] = useState<GroupDetailData | null>(null);
    const [loading, setLoading] = useState(true);
    const [tab, setTab] = useState<Tab>('overview');
    const [showInvite, setShowInvite] = useState(false);
    const [copied, setCopied] = useState(false);
    const [showCreateTrip, setShowCreateTrip] = useState(false);
    const [tripTitle, setTripTitle] = useState('');
    const [tripStart, setTripStart] = useState('');
    const [tripEnd, setTripEnd] = useState('');
    const [creatingTrip, setCreatingTrip] = useState(false);
    const [suggestedSettlements, setSuggestedSettlements] = useState<
        { from: string; fromName: string; to: string; toName: string; amount: number }[]
    >([]);
    const [memberToRemove, setMemberToRemove] = useState<MemberData | null>(null);
    const [removingMember, setRemovingMember] = useState(false);
    const [showContactPicker, setShowContactPicker] = useState(false);
    const [inviteContacts, setInviteContacts] = useState<ContactForInvite[]>([]);
    const [loadingContacts, setLoadingContacts] = useState(false);
    const [sendingContactInvite, setSendingContactInvite] = useState<string | null>(null);
    const [upiModal, setUpiModal] = useState<{ open: boolean; settlementId: string; amount: number; payeeName: string }>({ open: false, settlementId: '', amount: 0, payeeName: '' });
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [deletingGroup, setDeletingGroup] = useState(false);
    const { toast } = useToast();

    const fetchGroup = useCallback(async () => {
        try {
            const [groupRes, balancesRes] = await Promise.all([
                fetch(`/api/groups/${groupId}`),
                fetch(`/api/groups/${groupId}/balances`),
            ]);
            if (groupRes.ok) {
                const data = await groupRes.json();
                // Use balances from the dedicated balances API if available
                // (it accounts for settlements; the detail API doesn't)
                if (balancesRes.ok) {
                    const bData = await balancesRes.json();
                    data.balances = bData.balances || data.balances;
                    setSuggestedSettlements(bData.settlements || []);
                }
                setGroup(data);
            }
        } catch (err) {
            console.error('Failed to fetch group:', err);
        } finally {
            setLoading(false);
        }
    }, [groupId]);

    useEffect(() => { fetchGroup(); }, [fetchGroup]);

    const handleCopy = () => {
        if (!group) return;
        const link = `${window.location.origin}/join/${group.inviteCode}`;
        navigator.clipboard.writeText(link);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    // ── Invite from contacts ──
    const openContactPicker = async () => {
        setShowContactPicker(true);
        setLoadingContacts(true);
        try {
            const res = await fetch('/api/contacts');
            if (res.ok) {
                const data = await res.json();
                // Only show linked contacts who are ON the app
                setInviteContacts(data.filter((c: ContactForInvite) => c.linkedUser));
            }
        } catch {
            toast('Failed to load contacts', 'error');
        } finally {
            setLoadingContacts(false);
        }
    };

    const sendContactInvite = async (contact: ContactForInvite) => {
        if (!group || !contact.linkedUser) return;
        setSendingContactInvite(contact.linkedUser.id);
        try {
            const res = await fetch('/api/invitations', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ groupId: group.id, inviteeId: contact.linkedUser.id }),
            });
            const data = await res.json();
            if (res.ok) {
                toast(`Invited ${contact.name}!`, 'success');
            } else {
                toast(data.error || 'Failed to invite', 'error');
            }
        } catch {
            toast('Network error', 'error');
        } finally {
            setSendingContactInvite(null);
        }
    };

    if (loading) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', padding: 'var(--space-4) 0' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                    <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(var(--accent-500-rgb), 0.06)' }} />
                    <div style={{ flex: 1 }}>
                        <div style={{ width: '50%', height: 16, borderRadius: 6, background: 'rgba(var(--accent-500-rgb), 0.08)', marginBottom: 6 }} />
                        <div style={{ width: '30%', height: 10, borderRadius: 6, background: 'rgba(var(--accent-500-rgb), 0.05)' }} />
                    </div>
                </div>
                <Card padding="normal">
                    <div style={{ height: 80, borderRadius: 8, background: 'rgba(var(--accent-500-rgb), 0.04)' }} />
                </Card>
            </div>
        );
    }

    if (!group) {
        return (
            <Card padding="normal">
                <div style={{ textAlign: 'center', padding: 'var(--space-8) var(--space-4)' }}>
                    <Inbox size={48} style={{ color: 'var(--fg-muted)', marginBottom: 'var(--space-3)' }} />
                    <h3 style={{ fontSize: 'var(--text-base)', fontWeight: 600, marginBottom: 'var(--space-1)' }}>Group not found</h3>
                    <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-tertiary)', marginBottom: 'var(--space-4)' }}>
                        This group may have been deleted or you don&apos;t have access.
                    </p>
                    <Button size="sm" onClick={() => router.push('/groups')}>Back to Groups</Button>
                </div>
            </Card>
        );
    }

    const members = group.members;
    const activeTrip = group.activeTrip;
    const allTransactions = group.trips.flatMap(t => t.transactions);
    const recentTransactions = allTransactions.slice(0, 5);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)', paddingTop: 'var(--space-2)' }}>
            {/* ── Hero Section: Header + Trip ── */}
            <div style={{
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 'var(--space-4)',
            }}>
                {/* Back & Share — floating on sides */}
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    width: '100%',
                    position: 'absolute',
                    top: 2,
                    left: 0,
                    right: 0,
                    zIndex: 2,
                }}>
                    <button
                        onClick={() => router.push('/groups')}
                        style={{
                            border: 'none',
                            background: 'rgba(var(--accent-500-rgb), 0.06)',
                            cursor: 'pointer',
                            color: 'var(--fg-secondary)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            padding: 6,
                            borderRadius: 'var(--radius-md)',
                            transition: 'all 0.15s',
                        }}
                    >
                        <ArrowLeft size={18} />
                    </button>
                    <Button size="sm" variant="ghost" iconOnly onClick={() => setShowInvite(true)}>
                        <Share2 size={18} />
                    </Button>
                    {group.currentUserId === group.ownerId && (
                        <Button size="sm" variant="ghost" iconOnly onClick={() => setShowDeleteConfirm(true)}
                            style={{ color: 'var(--color-error, #ef4444)' }}>
                            <Trash2 size={18} />
                        </Button>
                    )}
                </div>

                {/* ── Delete Group Confirmation Modal ── */}
                <AnimatePresence>
                    {showDeleteConfirm && (
                        <motion.div
                            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                            style={{
                                position: 'fixed', inset: 0, zIndex: 999,
                                background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                padding: 'var(--space-4)',
                            }}
                            onClick={() => setShowDeleteConfirm(false)}
                        >
                            <motion.div
                                initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
                                transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                                onClick={e => e.stopPropagation()}
                                style={{
                                    background: 'var(--bg-elevated)', borderRadius: 'var(--radius-2xl)',
                                    padding: 'var(--space-5)', maxWidth: 360, width: '100%',
                                    border: '1px solid var(--border-subtle)',
                                    boxShadow: 'var(--shadow-xl)',
                                }}
                            >
                                <h3 style={{ fontSize: 'var(--text-lg)', marginBottom: 'var(--space-2)' }}>Delete Group?</h3>
                                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-secondary)', marginBottom: 'var(--space-4)' }}>
                                    This will permanently delete <strong>{group.name}</strong>, all transactions, and cancel all pending settlements. This action cannot be undone.
                                </p>
                                <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                                    <Button size="sm" variant="ghost" style={{ flex: 1 }}
                                        onClick={() => setShowDeleteConfirm(false)}>Cancel</Button>
                                    <Button size="sm" style={{
                                        flex: 1, background: 'linear-gradient(135deg, #ef4444, #dc2626)', color: '#fff',
                                    }}
                                        disabled={deletingGroup}
                                        onClick={async () => {
                                            setDeletingGroup(true);
                                            try {
                                                const res = await fetch(`/api/groups/${groupId}`, { method: 'DELETE' });
                                                if (res.ok) {
                                                    toast('Group deleted successfully', 'success');
                                                    router.push('/groups');
                                                } else {
                                                    const err = await res.json().catch(() => ({}));
                                                    toast(err.error || 'Failed to delete group', 'error');
                                                }
                                            } catch { toast('Network error', 'error'); }
                                            finally { setDeletingGroup(false); setShowDeleteConfirm(false); }
                                        }}
                                    >
                                        {deletingGroup ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                                        {deletingGroup ? 'Deleting...' : 'Delete'}
                                    </Button>
                                </div>
                            </motion.div>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Group identity — centered */}
                <motion.div
                    layoutId={`group-${group.id}`}
                    style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        textAlign: 'center',
                        paddingTop: 'var(--space-2)',
                    }}
                >
                    <span style={{
                        fontSize: 36,
                        lineHeight: 1,
                        marginBottom: 'var(--space-2)',
                        filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.08))',
                    }}>{group.emoji}</span>
                    <h2 style={{
                        fontSize: 'var(--text-xl)',
                        fontWeight: 800,
                        letterSpacing: '-0.02em',
                        margin: 0,
                    }}>{group.name}</h2>
                    <p style={{
                        fontSize: 'var(--text-xs)',
                        color: 'var(--fg-tertiary)',
                        marginTop: 4,
                        fontWeight: 500,
                    }}>
                        {members.length} members · Created {new Date(group.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </p>
                </motion.div>

                {/* Trip Summary — unified card */}
                {activeTrip ? (
                    <Card padding="normal" glow>
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 'var(--space-2)',
                            marginBottom: 'var(--space-4)',
                        }}>
                            <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                                padding: '4px 10px',
                                borderRadius: 'var(--radius-full)',
                                background: 'rgba(var(--accent-500-rgb), 0.06)',
                                fontSize: 'var(--text-xs)',
                                color: 'var(--fg-secondary)',
                                fontWeight: 600,
                            }}>
                                <Calendar size={12} style={{ color: 'var(--accent-500)' }} />
                                {new Date(activeTrip.startDate || activeTrip.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                                {' → '}
                                {activeTrip.endDate ? new Date(activeTrip.endDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : 'Present'}
                            </div>
                            <Badge variant="accent" size="sm">{activeTrip.isActive ? 'Active' : 'Closed'}</Badge>
                        </div>
                        <div style={{
                            display: 'grid',
                            gridTemplateColumns: '1fr 1fr',
                            gap: 'var(--space-3)',
                        }}>
                            <div style={{
                                textAlign: 'center',
                                padding: 'var(--space-3)',
                                borderRadius: 'var(--radius-lg)',
                                background: 'rgba(var(--accent-500-rgb), 0.03)',
                            }}>
                                <p style={{ fontSize: 10, color: 'var(--fg-muted)', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total Spent</p>
                                <p style={{ fontSize: 'var(--text-xl)', fontWeight: 800, letterSpacing: '-0.02em' }}>{formatCurrency(group.totalSpent)}</p>
                            </div>
                            <div style={{
                                textAlign: 'center',
                                padding: 'var(--space-3)',
                                borderRadius: 'var(--radius-lg)',
                                background: 'rgba(var(--accent-500-rgb), 0.03)',
                            }}>
                                <p style={{ fontSize: 10, color: 'var(--fg-muted)', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Per Person</p>
                                <p style={{ fontSize: 'var(--text-xl)', fontWeight: 800, letterSpacing: '-0.02em' }}>{formatCurrency(members.length > 0 ? Math.round(group.totalSpent / members.length) : 0)}</p>
                            </div>
                        </div>
                    </Card>
                ) : (
                    <Card padding="normal">
                        <div style={{ textAlign: 'center', padding: 'var(--space-4)' }}>
                            <Calendar size={32} style={{ color: 'var(--fg-muted)', marginBottom: 'var(--space-2)' }} />
                            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-tertiary)', marginBottom: 'var(--space-3)' }}>No active trip yet</p>
                            <Button size="sm" leftIcon={<Plus size={14} />} onClick={() => setShowCreateTrip(true)}>Create Trip</Button>
                        </div>
                    </Card>
                )}
            </div>

            {/* ── Tabs ── */}
            <div style={{
                display: 'flex',
                background: 'var(--bg-tertiary)',
                borderRadius: 'var(--radius-lg)',
                padding: 4,
                marginTop: 'var(--space-1)',
            }}>
                {(['overview', 'members', 'activity', 'chat'] as const).map((t) => (
                    <button
                        key={t}
                        onClick={() => setTab(t)}
                        style={{
                            flex: 1,
                            padding: '8px 12px',
                            borderRadius: 'var(--radius-md)',
                            border: 'none',
                            cursor: 'pointer',
                            fontSize: 'var(--text-sm)',
                            fontWeight: 500,
                            background: tab === t ? 'var(--surface-card)' : 'transparent',
                            color: tab === t ? 'var(--fg-primary)' : 'var(--fg-tertiary)',
                            boxShadow: tab === t ? 'var(--shadow-sm)' : 'none',
                            transition: 'all 0.2s',
                        }}
                    >
                        {t === 'chat' ? '💬 Chat' : t.charAt(0).toUpperCase() + t.slice(1)}
                    </button>
                ))}
            </div>

            {/* ── Tab Content ── */}
            <AnimatePresence mode="wait">
                {tab === 'overview' && (
                    <motion.div
                        key="overview"
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={{ duration: 0.2 }}
                        style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}
                    >
                        {/* Balances */}
                        <div>
                            <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 700, marginBottom: 'var(--space-3)', color: 'var(--fg-secondary)', letterSpacing: '-0.01em' }}>
                                Balances
                            </h3>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                                {members.map((member) => {
                                    const balance = group.balances[member.userId] || 0;
                                    const isCurrentUser = member.userId === group.currentUserId;
                                    return (
                                        <Card key={member.userId} padding="compact">
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                                                <Avatar name={member.user.name || 'User'} image={member.user.image} size="sm" />
                                                <span style={{ flex: 1, fontSize: 'var(--text-sm)', fontWeight: 500 }}>
                                                    {member.user.name || 'User'}
                                                    {isCurrentUser && <span style={{ color: 'var(--fg-tertiary)' }}> (You)</span>}
                                                </span>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
                                                    {balance > 0 ? (
                                                        <TrendingUp size={14} style={{ color: 'var(--color-success)' }} />
                                                    ) : balance < 0 ? (
                                                        <TrendingDown size={14} style={{ color: 'var(--color-error)' }} />
                                                    ) : null}
                                                    <span style={{
                                                        fontSize: 'var(--text-sm)',
                                                        fontWeight: 600,
                                                        color: balance > 0 ? 'var(--color-success)' : balance < 0 ? 'var(--color-error)' : 'var(--fg-tertiary)',
                                                    }}>
                                                        {balance > 0 ? '+' : ''}{formatCurrency(Math.abs(balance))}
                                                    </span>
                                                </div>
                                            </div>
                                        </Card>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Simplify Debts — Suggested Settlements */}
                        {suggestedSettlements.length > 0 && (
                            <div>
                                <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: 'var(--space-2)', color: 'var(--fg-secondary)' }}>
                                    ⚡ Simplify Debts
                                </h3>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                                    {suggestedSettlements.map((s, i) => (
                                        <motion.div
                                            key={`${s.from}-${s.to}`}
                                            initial={{ opacity: 0, x: -12 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            transition={{ delay: i * 0.08 }}
                                        >
                                            <Card padding="compact">
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                                                    <div style={{
                                                        width: 32, height: 32, borderRadius: 'var(--radius-full)',
                                                        background: 'rgba(var(--accent-500-rgb), 0.08)',
                                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                        color: 'var(--accent-500)', fontSize: 14, flexShrink: 0,
                                                    }}>
                                                        <ArrowRightLeft size={15} />
                                                    </div>
                                                    <div style={{ flex: 1, minWidth: 0 }}>
                                                        <div style={{ fontSize: 'var(--text-sm)', fontWeight: 500 }}>
                                                            <span style={{ fontWeight: 600 }}>{s.fromName}</span>
                                                            <span style={{ color: 'var(--fg-tertiary)', margin: '0 4px' }}>→</span>
                                                            <span style={{ fontWeight: 600 }}>{s.toName}</span>
                                                        </div>
                                                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)' }}>
                                                            Suggested transfer
                                                        </div>
                                                    </div>
                                                    <span style={{
                                                        fontWeight: 700, fontSize: 'var(--text-sm)',
                                                        color: 'var(--accent-500)',
                                                    }}>
                                                        {formatCurrency(s.amount)}
                                                    </span>
                                                    {s.from === group.currentUserId && (
                                                        <button
                                                            onClick={() => setUpiModal({ open: true, settlementId: `${s.from}-${s.to}`, amount: s.amount, payeeName: s.toName })}
                                                            style={{
                                                                padding: '4px 10px',
                                                                background: 'linear-gradient(135deg, #4CAF50, #2E7D32)',
                                                                color: '#fff',
                                                                border: 'none',
                                                                borderRadius: 8,
                                                                fontSize: 11,
                                                                fontWeight: 600,
                                                                cursor: 'pointer',
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                gap: 4,
                                                                flexShrink: 0,
                                                            }}
                                                        >
                                                            <CreditCard size={12} />
                                                            Pay
                                                        </button>
                                                    )}
                                                </div>
                                            </Card>
                                        </motion.div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Quick Actions */}
                        <div style={{
                            display: 'flex', gap: 'var(--space-2)',
                            marginBottom: 'var(--space-2)',
                        }}>
                            <button
                                onClick={() => router.push(`/groups/${groupId}/receipts`)}
                                style={{
                                    flex: 1, padding: '10px 14px',
                                    borderRadius: 'var(--radius-lg)',
                                    background: 'var(--bg-glass)',
                                    backdropFilter: 'blur(12px)',
                                    border: '1px solid var(--border-glass)',
                                    cursor: 'pointer',
                                    display: 'flex', alignItems: 'center', gap: 8,
                                    color: 'var(--fg-secondary)',
                                    fontSize: 'var(--text-sm)', fontWeight: 600,
                                    transition: 'all 0.2s',
                                }}
                            >
                                📷 Receipts
                            </button>
                            <button
                                onClick={() => router.push('/settlements')}
                                style={{
                                    flex: 1, padding: '10px 14px',
                                    borderRadius: 'var(--radius-lg)',
                                    background: 'var(--bg-glass)',
                                    backdropFilter: 'blur(12px)',
                                    border: '1px solid var(--border-glass)',
                                    cursor: 'pointer',
                                    display: 'flex', alignItems: 'center', gap: 8,
                                    color: 'var(--fg-secondary)',
                                    fontSize: 'var(--text-sm)', fontWeight: 600,
                                    transition: 'all 0.2s',
                                }}
                            >
                                💸 Settlements
                            </button>
                        </div>

                        {/* Recent Transactions */}
                        <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
                                <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--fg-secondary)', letterSpacing: '-0.01em' }}>Recent</h3>
                                <Button variant="ghost" size="sm" onClick={() => setTab('activity')}>View All</Button>
                            </div>
                            {recentTransactions.length > 0 ? (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                                    {recentTransactions.map((txn) => (
                                        <Card key={txn.id} interactive padding="compact">
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                                                <span style={{ fontSize: 22 }}>{CATEGORY_EMOJI[txn.category] || '📦'}</span>
                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                    <div style={{ fontSize: 'var(--text-sm)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                        {txn.title}
                                                    </div>
                                                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)' }}>
                                                        {(txn.payer.name || 'Unknown').split(' ')[0]} · {timeAgo(txn.createdAt)}
                                                    </div>
                                                </div>
                                                <span style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>{formatCurrency(txn.amount)}</span>
                                            </div>
                                        </Card>
                                    ))}
                                </div>
                            ) : (
                                <Card padding="compact">
                                    <p style={{ textAlign: 'center', fontSize: 'var(--text-sm)', color: 'var(--fg-tertiary)', padding: 'var(--space-3)' }}>
                                        No transactions yet
                                    </p>
                                </Card>
                            )}
                        </div>

                        {/* Quick Actions */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)', marginTop: 'var(--space-1)' }}>
                            <Button fullWidth leftIcon={<Plus size={16} />} onClick={() => router.push('/transactions/new')}>
                                Add Expense
                            </Button>
                            <Button fullWidth variant="outline" leftIcon={<ArrowRightLeft size={16} />} onClick={() => router.push('/settlements')}>
                                Settle Up
                            </Button>
                        </div>
                    </motion.div>
                )}

                {tab === 'members' && (
                    <motion.div
                        key="members"
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={{ duration: 0.2 }}
                        style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}
                    >
                        {members.map((member, i) => {
                            const balance = group.balances[member.userId] || 0;
                            const isCurrentUser = member.userId === group.currentUserId;
                            const canRemove = !isCurrentUser && group.currentUserId === group.members.find(m => m.role === 'admin')?.userId;
                            return (
                                <motion.div
                                    key={member.userId}
                                    initial={{ opacity: 0, y: 12 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: i * 0.06 }}
                                >
                                    <Card padding="normal">
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                                            <Avatar name={member.user.name || 'User'} image={member.user.image} size="md" />
                                            <div style={{ flex: 1 }}>
                                                <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>
                                                    {member.user.name || 'User'}
                                                    {isCurrentUser && <span style={{ color: 'var(--fg-tertiary)' }}> (You)</span>}
                                                </div>
                                                <Badge
                                                    variant={member.role === 'admin' ? 'accent' : 'default'}
                                                    size="sm"
                                                >
                                                    {member.role}
                                                </Badge>
                                            </div>
                                            <div style={{ textAlign: 'right' }}>
                                                <div style={{
                                                    fontSize: 'var(--text-sm)',
                                                    fontWeight: 600,
                                                    color: balance > 0 ? 'var(--color-success)' : balance < 0 ? 'var(--color-error)' : 'var(--fg-tertiary)',
                                                }}>
                                                    {balance > 0 ? 'gets back' : balance < 0 ? 'owes' : 'settled'}
                                                </div>
                                                <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--fg-primary)' }}>
                                                    {formatCurrency(Math.abs(balance))}
                                                </div>
                                            </div>
                                            {canRemove && (
                                                <button
                                                    onClick={() => setMemberToRemove(member)}
                                                    style={{
                                                        background: 'rgba(239, 68, 68, 0.08)',
                                                        border: '1px solid rgba(239, 68, 68, 0.15)',
                                                        borderRadius: 'var(--radius-md)',
                                                        width: 32, height: 32,
                                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                        cursor: 'pointer', flexShrink: 0,
                                                        color: 'var(--color-error)',
                                                        transition: 'all 0.2s',
                                                    }}
                                                    onMouseEnter={(e) => {
                                                        e.currentTarget.style.background = 'rgba(239, 68, 68, 0.15)';
                                                    }}
                                                    onMouseLeave={(e) => {
                                                        e.currentTarget.style.background = 'rgba(239, 68, 68, 0.08)';
                                                    }}
                                                    title={`Remove ${member.user.name}`}
                                                >
                                                    <UserMinus size={14} />
                                                </button>
                                            )}
                                        </div>
                                    </Card>
                                </motion.div>
                            );
                        })}
                        <Button fullWidth variant="outline" leftIcon={<Users size={16} />} onClick={() => setShowInvite(true)}>
                            Invite via Link
                        </Button>
                        <Button fullWidth variant="secondary" leftIcon={<UserPlus size={16} />} onClick={openContactPicker}
                            style={{ marginTop: 'var(--space-1)' }}
                        >
                            Invite from Contacts
                        </Button>
                    </motion.div>
                )}

                {tab === 'activity' && (
                    <motion.div
                        key="activity"
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={{ duration: 0.2 }}
                        style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}
                    >
                        {allTransactions.length > 0 ? allTransactions.map((txn, i) => (
                            <motion.div
                                key={txn.id}
                                initial={{ opacity: 0, y: 12 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: i * 0.04 }}
                            >
                                <Card interactive padding="compact">
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                                        <span style={{ fontSize: 22 }}>{CATEGORY_EMOJI[txn.category] || '📦'}</span>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ fontSize: 'var(--text-sm)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                {txn.title}
                                            </div>
                                            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)' }}>
                                                {txn.payer.name || 'Unknown'} · {timeAgo(txn.createdAt)}
                                            </div>
                                        </div>
                                        <span style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>{formatCurrency(txn.amount)}</span>
                                    </div>
                                </Card>
                            </motion.div>
                        )) : (
                            <Card padding="compact">
                                <p style={{ textAlign: 'center', fontSize: 'var(--text-sm)', color: 'var(--fg-tertiary)', padding: 'var(--space-4)' }}>
                                    No transactions recorded yet
                                </p>
                            </Card>
                        )}
                    </motion.div>
                )}

                {tab === 'chat' && (
                    <motion.div
                        key="chat"
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={{ duration: 0.2 }}
                    >
                        <GroupChat
                            groupId={groupId}
                            currentUserId={group.currentUserId}
                            members={group.members}
                            balances={group.balances}
                            onPayRequest={(settlementId, amount, payeeName) =>
                                setUpiModal({ open: true, settlementId, amount, payeeName })
                            }
                        />
                    </motion.div>
                )}
            </AnimatePresence>

            {/* UPI Payment Modal */}
            <UpiPaymentModal
                isOpen={upiModal.open}
                onClose={() => setUpiModal({ open: false, settlementId: '', amount: 0, payeeName: '' })}
                settlementId={upiModal.settlementId}
                amount={upiModal.amount}
                payeeName={upiModal.payeeName}
                onPaymentComplete={() => {
                    setUpiModal({ open: false, settlementId: '', amount: 0, payeeName: '' });
                    fetchGroup();
                }}
            />

            {/* ── Invite Modal ── */}
            <Modal isOpen={showInvite} onClose={() => setShowInvite(false)} title="Invite to Group" size="small">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', textAlign: 'center' }}>
                    <p style={{ color: 'var(--fg-secondary)', fontSize: 'var(--text-sm)' }}>
                        Share this link or scan the QR code:
                    </p>

                    {/* QR Code */}
                    <div style={{
                        display: 'flex', justifyContent: 'center',
                        padding: 'var(--space-3)',
                        background: '#fff',
                        borderRadius: 'var(--radius-lg)',
                        width: 'fit-content', margin: '0 auto',
                    }}>
                        <QRCodeSVG
                            value={`${typeof window !== 'undefined' ? window.location.origin : ''}/join/${group.inviteCode}`}
                            size={160}
                            level="M"
                            bgColor="#ffffff"
                            fgColor="#1a1a2e"
                        />
                    </div>

                    {/* Link row */}
                    <div style={{
                        display: 'flex',
                        gap: 'var(--space-2)',
                        background: 'var(--bg-tertiary)',
                        padding: 'var(--space-2) var(--space-3)',
                        borderRadius: 'var(--radius-lg)',
                        alignItems: 'center',
                    }}>
                        <Link2 size={16} style={{ color: 'var(--fg-tertiary)', flexShrink: 0 }} />
                        <span style={{
                            flex: 1,
                            fontSize: 'var(--text-sm)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                        }}>
                            {`${typeof window !== 'undefined' ? window.location.origin : ''}/join/${group.inviteCode}`}
                        </span>
                        <Button size="sm" variant={copied ? 'ghost' : 'primary'} onClick={handleCopy}>
                            {copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy</>}
                        </Button>
                    </div>
                    <Button fullWidth variant="secondary" leftIcon={<Share2 size={16} />}
                        onClick={() => {
                            const link = `${window.location.origin}/join/${group.inviteCode}`;
                            const msg = encodeURIComponent(`Hey! Join our group "${group.name}" on SplitX to split expenses. Click here: ${link}`);
                            window.open(`https://wa.me/?text=${msg}`, '_blank');
                        }}
                    >
                        Share via WhatsApp
                    </Button>
                    <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                        <Button fullWidth variant="ghost" size="sm"
                            onClick={() => {
                                const link = `${window.location.origin}/join/${group.inviteCode}`;
                                const msg = encodeURIComponent(`Hey! Join our group "${group.name}" on SplitX: ${link}`);
                                window.open(`sms:?body=${msg}`, '_blank');
                            }}
                        >
                            💬 SMS
                        </Button>
                        <Button fullWidth variant="ghost" size="sm"
                            onClick={() => {
                                const link = `${window.location.origin}/join/${group.inviteCode}`;
                                const subject = encodeURIComponent(`Join ${group.name} on SplitX`);
                                const body = encodeURIComponent(`Hey! Join our group "${group.name}" on SplitX to split expenses.\n\nClick here: ${link}`);
                                window.open(`mailto:?subject=${subject}&body=${body}`, '_blank');
                            }}
                        >
                            ✉️ Email
                        </Button>
                    </div>
                </div>
            </Modal>

            {/* ── Contact Picker Modal ── */}
            <Modal isOpen={showContactPicker} onClose={() => setShowContactPicker(false)} title="Invite from Contacts" size="small">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                    {loadingContacts ? (
                        <div style={{ textAlign: 'center', padding: 'var(--space-6)' }}>
                            <Loader2 size={24} style={{ color: 'var(--accent-500)', animation: 'spin 1s linear infinite', margin: '0 auto' }} />
                            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-tertiary)', marginTop: 'var(--space-2)' }}>Loading contacts...</p>
                        </div>
                    ) : inviteContacts.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: 'var(--space-6)' }}>
                            <Users size={32} style={{ color: 'var(--fg-muted)', margin: '0 auto var(--space-2)' }} />
                            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-tertiary)' }}>No contacts on the app yet</p>
                        </div>
                    ) : (
                        <>
                            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)', marginBottom: 'var(--space-1)' }}>
                                Select a contact to invite to {group.name}:
                            </p>
                            {inviteContacts.map((contact) => {
                                const isAlreadyMember = group.members.some(m => m.userId === contact.linkedUser?.id);
                                const isSending = sendingContactInvite === contact.linkedUser?.id;
                                return (
                                    <button
                                        key={contact.id}
                                        onClick={() => !isAlreadyMember && !isSending && sendContactInvite(contact)}
                                        disabled={isAlreadyMember || isSending}
                                        style={{
                                            display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
                                            padding: 'var(--space-3) var(--space-4)', borderRadius: 'var(--radius-lg)',
                                            border: '1px solid var(--border-default)', background: 'var(--bg-secondary)',
                                            cursor: isAlreadyMember ? 'not-allowed' : 'pointer',
                                            color: 'var(--fg-primary)', fontSize: 'var(--text-sm)', fontWeight: 600,
                                            transition: 'all 0.15s ease', opacity: isAlreadyMember ? 0.5 : 1,
                                            textAlign: 'left', width: '100%',
                                        }}
                                    >
                                        <Avatar name={contact.name} image={contact.linkedUser?.image} size="sm" />
                                        <span style={{ flex: 1 }}>{contact.name}</span>
                                        {isAlreadyMember ? (
                                            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)' }}>Already in</span>
                                        ) : isSending ? (
                                            <Loader2 size={16} style={{ color: 'var(--accent-500)', animation: 'spin 1s linear infinite' }} />
                                        ) : (
                                            <Send size={14} style={{ color: 'var(--accent-500)' }} />
                                        )}
                                    </button>
                                );
                            })}
                        </>
                    )}
                </div>
            </Modal>

            {/* Create Trip Modal */}
            <Modal isOpen={showCreateTrip} onClose={() => setShowCreateTrip(false)} title="Create New Trip">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                    <Input
                        label="Trip Title"
                        value={tripTitle}
                        onChange={(e) => setTripTitle(e.target.value)}
                        placeholder="e.g. Goa Weekend Trip"
                    />
                    <Input
                        label="Start Date"
                        type="date"
                        value={tripStart}
                        onChange={(e) => setTripStart(e.target.value)}
                    />
                    <Input
                        label="End Date"
                        type="date"
                        value={tripEnd}
                        onChange={(e) => setTripEnd(e.target.value)}
                    />
                    <Button
                        fullWidth
                        disabled={creatingTrip || !tripTitle.trim()}
                        leftIcon={creatingTrip ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Plus size={14} />}
                        onClick={async () => {
                            setCreatingTrip(true);
                            try {
                                const res = await fetch('/api/trips', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                        groupId,
                                        title: tripTitle.trim(),
                                        startDate: tripStart || undefined,
                                        endDate: tripEnd || undefined,
                                    }),
                                });
                                if (res.ok) {
                                    toast('Trip created!', 'success');
                                    setShowCreateTrip(false);
                                    setTripTitle('');
                                    setTripStart('');
                                    setTripEnd('');
                                    setLoading(true);
                                    await fetchGroup();
                                } else {
                                    toast('Failed to create trip', 'error');
                                }
                            } catch {
                                toast('Network error', 'error');
                            } finally {
                                setCreatingTrip(false);
                            }
                        }}
                    >
                        Create Trip
                    </Button>
                </div>
            </Modal>

            {/* Remove Member Confirmation Modal */}
            <Modal isOpen={!!memberToRemove} onClose={() => setMemberToRemove(null)} title="Remove Member" size="small">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', textAlign: 'center' }}>
                    <div style={{
                        width: 56, height: 56, borderRadius: 'var(--radius-full)',
                        background: 'rgba(239, 68, 68, 0.1)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        margin: '0 auto', color: 'var(--color-error)',
                    }}>
                        <Trash2 size={24} />
                    </div>
                    <div>
                        <h3 style={{ fontSize: 'var(--text-base)', fontWeight: 700, marginBottom: 4 }}>
                            Remove {memberToRemove?.user.name || 'this member'}?
                        </h3>
                        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-tertiary)' }}>
                            This will remove them from the group. They won&apos;t be able to see transactions or settlements unless re-invited.
                        </p>
                    </div>
                    <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                        <Button
                            fullWidth
                            variant="outline"
                            onClick={() => setMemberToRemove(null)}
                            disabled={removingMember}
                        >
                            Cancel
                        </Button>
                        <Button
                            fullWidth
                            disabled={removingMember}
                            leftIcon={removingMember ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Trash2 size={14} />}
                            onClick={async () => {
                                if (!memberToRemove) return;
                                setRemovingMember(true);
                                try {
                                    const res = await fetch(`/api/groups/${groupId}/members`, {
                                        method: 'DELETE',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ userId: memberToRemove.userId }),
                                    });
                                    if (res.ok) {
                                        toast(`${memberToRemove.user.name || 'Member'} removed from group`, 'success');
                                        setMemberToRemove(null);
                                        setLoading(true);
                                        await fetchGroup();
                                    } else {
                                        const data = await res.json();
                                        toast(data.error || 'Failed to remove member', 'error');
                                    }
                                } catch {
                                    toast('Network error', 'error');
                                } finally {
                                    setRemovingMember(false);
                                }
                            }}
                            style={{
                                background: 'linear-gradient(135deg, #ef4444, #dc2626)',
                                borderColor: 'transparent',
                            }}
                        >
                            Remove
                        </Button>
                    </div>
                </div>
            </Modal>
        </div >
    );
}
