'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    ArrowLeft,
    Plus,
    Users,
    Receipt,
    ArrowRightLeft,
    Settings,
    Share2,
    Copy,
    Check,
    Calendar,
    TrendingUp,
    TrendingDown,
    Inbox,
    Loader2,
    Link2,
} from 'lucide-react';
import { useRouter, useParams } from 'next/navigation';
import Button from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import Avatar, { AvatarGroup } from '@/components/ui/Avatar';
import Badge from '@/components/ui/Badge';
import Modal from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { formatCurrency, timeAgo, cn } from '@/lib/utils';

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

type Tab = 'overview' | 'members' | 'activity';

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
    const { toast } = useToast();

    const fetchGroup = useCallback(async () => {
        try {
            const res = await fetch(`/api/groups/${groupId}`);
            if (res.ok) {
                const data = await res.json();
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            {/* ── Header ── */}
            <motion.div layoutId={`group-${group.id}`} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                <button
                    onClick={() => router.push('/groups')}
                    style={{
                        border: 'none',
                        background: 'none',
                        cursor: 'pointer',
                        color: 'var(--fg-secondary)',
                        display: 'flex',
                        padding: 4,
                    }}
                >
                    <ArrowLeft size={20} />
                </button>
                <span style={{ fontSize: 28 }}>{group.emoji}</span>
                <div style={{ flex: 1 }}>
                    <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 700 }}>{group.name}</h2>
                    <p style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)' }}>
                        {members.length} members · Created {new Date(group.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </p>
                </div>
                <Button size="sm" variant="ghost" iconOnly onClick={() => setShowInvite(true)}>
                    <Share2 size={18} />
                </Button>
            </motion.div>

            {/* ── Trip Summary Card ── */}
            {activeTrip ? (
                <Card padding="normal" glow>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
                        <Calendar size={16} style={{ color: 'var(--accent-500)' }} />
                        <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>{activeTrip.title}</div>
                            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)' }}>
                                {activeTrip.startDate ? new Date(activeTrip.startDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—'} → {activeTrip.endDate ? new Date(activeTrip.endDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—'}
                            </div>
                        </div>
                        <Badge variant="accent" size="sm">{activeTrip.isActive ? 'Active' : 'Closed'}</Badge>
                    </div>
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr',
                        gap: 'var(--space-3)',
                    }}>
                        <div>
                            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)', marginBottom: 2 }}>Total Spent</p>
                            <p style={{ fontSize: 'var(--text-xl)', fontWeight: 700 }}>{formatCurrency(group.totalSpent)}</p>
                        </div>
                        <div>
                            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)', marginBottom: 2 }}>Per Person</p>
                            <p style={{ fontSize: 'var(--text-xl)', fontWeight: 700 }}>{formatCurrency(members.length > 0 ? Math.round(group.totalSpent / members.length) : 0)}</p>
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

            {/* ── Tabs ── */}
            <div style={{
                display: 'flex',
                background: 'var(--bg-tertiary)',
                borderRadius: 'var(--radius-lg)',
                padding: 3,
            }}>
                {(['overview', 'members', 'activity'] as const).map((t) => (
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
                        {t.charAt(0).toUpperCase() + t.slice(1)}
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
                        style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}
                    >
                        {/* Balances */}
                        <div>
                            <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: 'var(--space-2)', color: 'var(--fg-secondary)' }}>
                                Balances
                            </h3>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                                {members.map((member) => {
                                    const balance = group.balances[member.userId] || 0;
                                    const isCurrentUser = member.userId === group.currentUserId;
                                    return (
                                        <Card key={member.userId} padding="compact">
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                                                <Avatar name={member.user.name || 'User'} size="sm" />
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

                        {/* Recent Transactions */}
                        <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
                                <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--fg-secondary)' }}>Recent</h3>
                                <Button variant="ghost" size="sm" onClick={() => setTab('activity')}>View All</Button>
                            </div>
                            {recentTransactions.length > 0 ? (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
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
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)' }}>
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
                            return (
                                <motion.div
                                    key={member.userId}
                                    initial={{ opacity: 0, y: 12 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: i * 0.06 }}
                                >
                                    <Card padding="normal">
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                                            <Avatar name={member.user.name || 'User'} size="md" />
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
                                        </div>
                                    </Card>
                                </motion.div>
                            );
                        })}
                        <Button fullWidth variant="outline" leftIcon={<Users size={16} />} onClick={() => setShowInvite(true)}>
                            Invite Members
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
            </AnimatePresence>

            {/* ── Invite Modal ── */}
            <Modal isOpen={showInvite} onClose={() => setShowInvite(false)} title="Invite to Group" size="small">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', textAlign: 'center' }}>
                    <p style={{ color: 'var(--fg-secondary)', fontSize: 'var(--text-sm)' }}>
                        Share this link with friends to invite them:
                    </p>
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
                        <Button size="sm" variant={copied ? 'ghost' : 'primary'} iconOnly onClick={handleCopy}>
                            {copied ? <Check size={16} /> : <Copy size={16} />}
                        </Button>
                    </div>
                    <Button fullWidth variant="secondary" leftIcon={<Share2 size={16} />}>
                        Share via WhatsApp
                    </Button>
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
        </div >
    );
}
