'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRightLeft, Check, Download, Share2, GitBranch, Inbox, CreditCard, Bell } from 'lucide-react';
import Button from '@/components/ui/Button';
import Avatar from '@/components/ui/Avatar';
import Badge from '@/components/ui/Badge';
import Modal from '@/components/ui/Modal';
import SettlementGraph from '@/components/features/SettlementGraph';
import UpiPaymentModal from '@/components/features/UpiPaymentModal';
import { useToast } from '@/components/ui/Toast';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { formatCurrency } from '@/lib/utils';
import { exportAsText, shareSettlement } from '@/lib/export';
import { SettlementSkeleton } from '@/components/ui/Skeleton';

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

/* ── Types ── */
interface UserRef { id: string; name: string | null; image?: string | null }
interface ComputedTransfer { from: string; to: string; amount: number; fromName?: string; toName?: string; fromImage?: string | null; toImage?: string | null; toUpiId?: string | null }
interface RecordedSettlement {
    id: string; fromId: string; toId: string; amount: number;
    status: string; method: string | null; note: string | null;
    from: UserRef; to: UserRef; createdAt: string;
}
interface SettlementApiResponse {
    computed: ComputedTransfer[];
    recorded: RecordedSettlement[];
    balances: Record<string, number>;
}

export default function SettlementsPage() {
    const [loading, setLoading] = useState(true);
    const { user: currentUser } = useCurrentUser();
    const { toast } = useToast();
    const [computed, setComputed] = useState<ComputedTransfer[]>([]);
    const [recorded, setRecorded] = useState<RecordedSettlement[]>([]);
    const [memberNames, setMemberNames] = useState<Record<string, string>>({});
    const [memberImages, setMemberImages] = useState<Record<string, string | null>>({});
    const [graphMembers, setGraphMembers] = useState<string[]>([]);
    const [activeTripId, setActiveTripId] = useState<string>('');
    const [tab, setTab] = useState<'pending' | 'settled'>('pending');
    const [showGraph, setShowGraph] = useState(false);
    const [confirmSettle, setConfirmSettle] = useState<{ from: string; to: string; amount: number } | null>(null);
    const [settling, setSettling] = useState(false);
    const [upiModal, setUpiModal] = useState<{ open: boolean; amount: number; payeeName: string; payeeUpiId?: string; settlementId?: string }>({ open: false, amount: 0, payeeName: '' });

    const fetchSettlements = useCallback(async () => {
        try {
            const groupsRes = await fetch('/api/groups');
            if (!groupsRes.ok) { setLoading(false); return; }
            const groups = await groupsRes.json();
            if (!Array.isArray(groups) || groups.length === 0) { setLoading(false); return; }

            // Build name + image maps from ALL group members
            const nameMap: Record<string, string> = {};
            const imgMap: Record<string, string | null> = {};
            for (const g of groups) {
                if (g.members) {
                    for (const m of g.members) {
                        const userId = m.userId || m.user?.id;
                        const name = m.user?.name || m.name || 'Unknown';
                        if (userId) {
                            nameMap[userId] = name;
                            imgMap[userId] = m.user?.image || null;
                        }
                    }
                }
            }
            setMemberNames(nameMap);
            setMemberImages(imgMap);

            // Collect active trip IDs from ALL groups
            let firstTripId = '';
            const detailPromises = groups.map((g: { id: string }) => fetch(`/api/groups/${g.id}`).then(r => r.ok ? r.json() : null));
            const details = await Promise.all(detailPromises);

            const tripIds: string[] = [];
            for (const detail of details) {
                if (detail?.activeTrip?.id) {
                    tripIds.push(detail.activeTrip.id);
                    if (!firstTripId) firstTripId = detail.activeTrip.id;
                }
            }

            if (tripIds.length === 0) { setLoading(false); return; }
            setActiveTripId(firstTripId);

            // Fetch global settlements (the API now aggregates across all trips when no tripId is given)
            const settRes = await fetch('/api/settlements');
            if (settRes.ok) {
                const data: SettlementApiResponse = await settRes.json();
                setComputed(data.computed || []);
                setRecorded(data.recorded || []);
                const allUserIds = new Set<string>();
                for (const t of data.computed) { allUserIds.add(t.from); allUserIds.add(t.to); }
                for (const r of data.recorded) { allUserIds.add(r.fromId); allUserIds.add(r.toId); }
                setGraphMembers(Array.from(allUserIds).map(id => nameMap[id] || id));
            }
        } catch (err) {
            console.error('Failed to fetch settlements:', err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchSettlements(); }, [fetchSettlements]);

    const currentUserId = currentUser?.id || null;

    const pendingSettlements = computed.map((t, i) => ({
        id: `computed-${i}`,
        from: { name: memberNames[t.from] || t.fromName || t.from, id: t.from, image: t.fromImage || memberImages[t.from] || null },
        to: { name: memberNames[t.to] || t.toName || t.to, id: t.to, image: t.toImage || memberImages[t.to] || null },
        amount: t.amount, status: 'pending' as const,
        toUpiId: t.toUpiId || null,
    }));

    const settledSettlements = recorded
        .filter(r => ['completed', 'confirmed', 'paid_pending'].includes(r.status))
        .map(r => ({
            id: r.id,
            from: { name: r.from.name || 'Unknown', id: r.fromId, image: r.from.image || null },
            to: { name: r.to.name || 'Unknown', id: r.toId, image: r.to.image || null },
            amount: r.amount, status: 'settled' as const,
        }));

    const allSettlements = [...pendingSettlements, ...settledSettlements];
    const filteredSettlements = allSettlements.filter(s =>
        tab === 'pending' ? s.status === 'pending' : s.status === 'settled'
    );

    const totalYouOwe = pendingSettlements.filter(s => s.from.id === currentUserId).reduce((sum, s) => sum + s.amount, 0);
    const totalOwedToYou = pendingSettlements.filter(s => s.to.id === currentUserId).reduce((sum, s) => sum + s.amount, 0);

    const graphSettlements = pendingSettlements.map(s => ({
        from: s.from.name, to: s.to.name, amount: s.amount,
    }));

    // Build name→image map for graph nodes
    const graphMemberImages: Record<string, string | null> = {};
    for (const [id, name] of Object.entries(memberNames)) {
        graphMemberImages[name] = memberImages[id] || null;
    }

    const handleMarkAsPaid = async () => {
        if (!confirmSettle) return;
        if (!activeTripId) {
            toast('No active trip found — please add an expense first', 'error');
            return;
        }
        setSettling(true);
        try {
            const res = await fetch('/api/settlements', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    tripId: activeTripId, toUserId: confirmSettle.to,
                    amount: confirmSettle.amount, method: 'cash',
                }),
            });
            if (res.ok) {
                toast('Settlement recorded ✅', 'success');
                setConfirmSettle(null);
                setLoading(true);
                await fetchSettlements();
            } else {
                const err = await res.json().catch(() => ({}));
                toast(err.error || 'Failed to record settlement', 'error');
            }
        } catch {
            toast('Network error', 'error');
        } finally {
            setSettling(false);
        }
    };

    if (loading) return <SettlementSkeleton />;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            {/* ═══ HEADER ═══ */}
            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
                <p style={{ color: 'var(--fg-tertiary)', fontSize: 'var(--text-xs)' }}>
                    Minimum transfers to settle all debts
                </p>
            </motion.div>

            {/* ═══ BALANCE OVERVIEW — Glassmorphic Hero ═══ */}
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.5, delay: 0.05 }}>
                <div style={{
                    ...glass, borderRadius: 'var(--radius-2xl)', padding: 'var(--space-4)',
                    background: 'linear-gradient(135deg, rgba(var(--accent-500-rgb), 0.08), var(--bg-glass), rgba(var(--accent-500-rgb), 0.04))',
                    boxShadow: 'var(--shadow-card), 0 0 30px rgba(var(--accent-500-rgb), 0.06)',
                }}>
                    {/* Top light edge */}
                    <div style={{
                        position: 'absolute', top: 0, left: '15%', right: '15%', height: 1,
                        background: 'linear-gradient(90deg, transparent, rgba(var(--accent-500-rgb), 0.15), transparent)',
                        pointerEvents: 'none',
                    }} />
                    <div style={{ position: 'relative', zIndex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
                        <div style={{
                            padding: 'var(--space-3)',
                            background: 'rgba(239, 68, 68, 0.06)',
                            borderRadius: 'var(--radius-xl)',
                            border: '1px solid rgba(239, 68, 68, 0.1)',
                            textAlign: 'center',
                        }}>
                            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-error)', fontWeight: 600, marginBottom: 4 }}>
                                You Owe
                            </div>
                            <div style={{ fontSize: 'var(--text-lg)', fontWeight: 800, color: 'var(--fg-primary)' }}>
                                {formatCurrency(totalYouOwe)}
                            </div>
                        </div>
                        <div style={{
                            padding: 'var(--space-3)',
                            background: 'rgba(16, 185, 129, 0.06)',
                            borderRadius: 'var(--radius-xl)',
                            border: '1px solid rgba(16, 185, 129, 0.1)',
                            textAlign: 'center',
                        }}>
                            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-success)', fontWeight: 600, marginBottom: 4 }}>
                                Owed to You
                            </div>
                            <div style={{ fontSize: 'var(--text-lg)', fontWeight: 800, color: 'var(--fg-primary)' }}>
                                {formatCurrency(totalOwedToYou)}
                            </div>
                        </div>
                    </div>
                </div>
            </motion.div>

            {/* ═══ TRANSFER GRAPH TOGGLE ═══ */}
            {graphMembers.length > 0 && (
                <>
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }}>
                        <button
                            onClick={() => setShowGraph(!showGraph)}
                            style={{
                                width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                                padding: '10px 16px', borderRadius: 'var(--radius-xl)',
                                ...glass, cursor: 'pointer',
                                color: showGraph ? 'var(--accent-400)' : 'var(--fg-secondary)',
                                fontSize: 'var(--text-sm)', fontWeight: 600, transition: 'all 0.2s',
                            }}
                        >
                            <GitBranch size={15} /> {showGraph ? 'Hide' : 'Show'} Transfer Graph
                        </button>
                    </motion.div>
                    <AnimatePresence>
                        {showGraph && (
                            <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.3 }}
                                style={{ overflow: 'hidden' }}
                            >
                                <div style={{ ...glass, borderRadius: 'var(--radius-2xl)', padding: 'var(--space-4)' }}>
                                    <SettlementGraph members={graphMembers} settlements={graphSettlements} memberImages={graphMemberImages} />
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </>
            )}

            {/* ═══ TABS — Glassmorphic Segmented Control ═══ */}
            <div style={{
                display: 'flex', ...glass, borderRadius: 'var(--radius-xl)', padding: 3,
            }}>
                {(['pending', 'settled'] as const).map((t) => (
                    <button
                        key={t}
                        onClick={() => setTab(t)}
                        style={{
                            flex: 1, padding: '9px 16px', borderRadius: 'var(--radius-lg)',
                            border: 'none', cursor: 'pointer',
                            fontSize: 'var(--text-sm)', fontWeight: 600,
                            background: tab === t
                                ? 'linear-gradient(135deg, rgba(var(--accent-500-rgb), 0.15), rgba(var(--accent-500-rgb), 0.08))'
                                : 'transparent',
                            color: tab === t ? 'var(--accent-400)' : 'var(--fg-tertiary)',
                            boxShadow: tab === t ? '0 0 12px rgba(var(--accent-500-rgb), 0.1)' : 'none',
                            transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
                        }}
                    >
                        {t === 'pending' ? `Pending (${pendingSettlements.length})` : `Settled (${settledSettlements.length})`}
                    </button>
                ))}
            </div>

            {/* ═══ SETTLEMENT LIST — Glassmorphic Cards ═══ */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                {filteredSettlements.length === 0 ? (
                    <div style={{
                        ...glass, borderRadius: 'var(--radius-2xl)',
                        padding: 'var(--space-10) var(--space-4)', textAlign: 'center',
                    }}>
                        <div style={{ position: 'relative', zIndex: 1 }}>
                            <div style={{
                                width: 52, height: 52, borderRadius: 'var(--radius-2xl)',
                                background: 'rgba(var(--accent-500-rgb), 0.08)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                margin: '0 auto var(--space-3)', color: 'var(--accent-400)',
                            }}>
                                <Inbox size={24} />
                            </div>
                            <div style={{ fontWeight: 600, color: 'var(--fg-primary)', marginBottom: 4 }}>
                                {tab === 'pending' ? 'All settled up! 🎉' : 'No settled payments yet'}
                            </div>
                            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)' }}>
                                {tab === 'pending' ? 'No pending settlements.' : 'Mark payments as settled to track them here.'}
                            </div>
                        </div>
                    </div>
                ) : filteredSettlements.map((settlement, i) => {
                    const isSender = settlement.from.id === currentUserId;
                    const isReceiver = settlement.to.id === currentUserId;
                    const isSettled = settlement.status === 'settled';

                    return (
                        <motion.div
                            key={settlement.id}
                            initial={{ opacity: 0, y: 12 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: i * 0.06, duration: 0.4 }}
                        >
                            <div style={{
                                ...glass,
                                borderRadius: 'var(--radius-xl)',
                                padding: 'var(--space-4)',
                                opacity: isSettled ? 0.65 : 1,
                                borderColor: isSender ? 'rgba(239, 68, 68, 0.12)' : isReceiver ? 'rgba(16, 185, 129, 0.12)' : 'var(--border-glass)',
                                transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
                            }}
                                onMouseEnter={(e) => {
                                    if (!isSettled) {
                                        e.currentTarget.style.transform = 'translateY(-2px)';
                                        e.currentTarget.style.boxShadow = 'var(--shadow-card-hover)';
                                    }
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.transform = 'translateY(0)';
                                    e.currentTarget.style.boxShadow = '';
                                }}
                            >
                                {/* Transfer direction — centered row */}
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-3)', marginBottom: (!isSettled || isSettled) ? 'var(--space-3)' : 0 }}>
                                    <Avatar name={settlement.from.name} image={settlement.from.image} size="sm" />
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--text-sm)' }}>
                                        <span style={{
                                            fontWeight: 700,
                                            color: isSender ? 'var(--color-error)' : 'var(--fg-primary)',
                                        }}>
                                            {isSender ? 'You' : settlement.from.name}
                                        </span>
                                        <ArrowRightLeft size={13} style={{ color: 'var(--fg-muted)' }} />
                                        <span style={{
                                            fontWeight: 700,
                                            color: isReceiver ? 'var(--color-success)' : 'var(--fg-primary)',
                                        }}>
                                            {isReceiver ? 'You' : settlement.to.name}
                                        </span>
                                    </div>
                                    <span style={{
                                        fontSize: 'var(--text-lg)', fontWeight: 800,
                                        background: isSender
                                            ? 'linear-gradient(135deg, var(--color-error), #fca5a5)'
                                            : isReceiver
                                                ? 'linear-gradient(135deg, var(--color-success), #6ee7b7)'
                                                : 'linear-gradient(135deg, var(--fg-primary), var(--fg-secondary))',
                                        WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
                                    }}>
                                        {formatCurrency(settlement.amount)}
                                    </span>
                                </div>

                                {/* Actions — centered via text-align since buttons are inline-flex */}
                                {!isSettled && (
                                    <div style={{ textAlign: 'center', width: '100%' }}>
                                        {isSender && (
                                            <Button size="sm" leftIcon={<CreditCard size={13} />}
                                                style={{
                                                    background: 'linear-gradient(135deg, #4CAF50, #2E7D32)',
                                                    boxShadow: '0 4px 16px rgba(76,175,80,0.25)',
                                                }}
                                                onClick={async () => {
                                                    if (!activeTripId) { toast('No active trip', 'error'); return; }
                                                    try {
                                                        // Create settlement record first to get a real DB ID
                                                        const res = await fetch('/api/settlements', {
                                                            method: 'POST',
                                                            headers: { 'Content-Type': 'application/json' },
                                                            body: JSON.stringify({
                                                                tripId: activeTripId,
                                                                toUserId: settlement.to.id,
                                                                amount: settlement.amount,
                                                                method: 'upi',
                                                            }),
                                                        });
                                                        if (!res.ok) {
                                                            const err = await res.json().catch(() => ({}));
                                                            toast(err.error || 'Failed to create settlement', 'error');
                                                            return;
                                                        }
                                                        const created = await res.json();
                                                        setUpiModal({
                                                            open: true,
                                                            amount: settlement.amount,
                                                            payeeName: settlement.to.name,
                                                            payeeUpiId: settlement.toUpiId || undefined,
                                                            settlementId: created.id,
                                                        });
                                                    } catch {
                                                        toast('Network error', 'error');
                                                    }
                                                }}
                                            >
                                                Pay via UPI
                                            </Button>
                                        )}
                                        {isReceiver && (
                                            <Button size="sm" variant="outline"
                                                leftIcon={<Bell size={13} />}
                                                onClick={async () => {
                                                    try {
                                                        const res = await fetch('/api/notifications', {
                                                            method: 'POST',
                                                            headers: { 'Content-Type': 'application/json' },
                                                            body: JSON.stringify({
                                                                userId: settlement.from.id,
                                                                type: 'payment_reminder',
                                                                title: 'Payment Reminder',
                                                                body: `${settlement.to.name} is reminding you to pay ${formatCurrency(settlement.amount)}`,
                                                                link: '/settlements',
                                                            }),
                                                        });
                                                        if (res.ok) {
                                                            toast('Reminder sent!', 'success');
                                                        } else {
                                                            toast('Failed to send reminder', 'error');
                                                        }
                                                    } catch {
                                                        toast('Network error', 'error');
                                                    }
                                                }}
                                            >
                                                Remind
                                            </Button>
                                        )}
                                        {(isSender || isReceiver) && (
                                            <Button size="sm" variant="ghost" iconOnly
                                                onClick={() => setConfirmSettle({ from: settlement.from.id, to: settlement.to.id, amount: settlement.amount })}
                                                style={{ borderRadius: 'var(--radius-lg)' }}
                                            >
                                                <Check size={15} />
                                            </Button>
                                        )}
                                        {!isSender && !isReceiver && (
                                            <Badge variant="accent">Between others</Badge>
                                        )}
                                    </div>
                                )}

                                {isSettled && (
                                    <div style={{ display: 'flex', justifyContent: 'center' }}>
                                        <Badge variant="success" size="sm">
                                            <Check size={11} /> Settled
                                        </Badge>
                                    </div>
                                )}
                            </div>
                        </motion.div>
                    );
                })}
            </div>

            {/* ═══ EXPORT ACTIONS ═══ */}
            {pendingSettlements.length > 0 && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }}>
                    <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                        <button
                            onClick={() => {
                                const data = {
                                    groupName: 'Group', tripName: 'Trip',
                                    members: graphMembers.map(m => ({ name: m })),
                                    transactions: [], settlements: graphSettlements,
                                    totalSpent: pendingSettlements.reduce((sum, s) => sum + s.amount, 0),
                                    exportDate: new Date(),
                                };
                                exportAsText(data);
                            }}
                            style={{
                                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                                padding: '10px', borderRadius: 'var(--radius-xl)',
                                ...glass, cursor: 'pointer',
                                color: 'var(--fg-secondary)', fontSize: 'var(--text-xs)', fontWeight: 600,
                                transition: 'all 0.2s',
                            }}
                        >
                            <Download size={14} /> Export
                        </button>
                        <button
                            onClick={() => {
                                const data = {
                                    groupName: 'Group', tripName: 'Trip',
                                    members: graphMembers.map(m => ({ name: m })),
                                    transactions: [], settlements: graphSettlements,
                                    totalSpent: pendingSettlements.reduce((sum, s) => sum + s.amount, 0),
                                    exportDate: new Date(),
                                };
                                shareSettlement(data);
                            }}
                            style={{
                                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                                padding: '10px', borderRadius: 'var(--radius-xl)',
                                ...glass, cursor: 'pointer',
                                color: 'var(--fg-secondary)', fontSize: 'var(--text-xs)', fontWeight: 600,
                                transition: 'all 0.2s',
                            }}
                        >
                            <Share2 size={14} /> Share
                        </button>
                    </div>
                </motion.div>
            )}

            {/* ═══ CONFIRM SETTLEMENT MODAL ═══ */}
            <Modal
                isOpen={!!confirmSettle}
                onClose={() => setConfirmSettle(null)}
                title="Confirm Settlement"
                size="small"
            >
                {confirmSettle && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', textAlign: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-3)' }}>
                            <Avatar name={memberNames[confirmSettle.from] || 'User'} image={memberImages[confirmSettle.from]} size="md" />
                            <ArrowRightLeft size={20} style={{ color: 'var(--fg-muted)' }} />
                            <Avatar name={memberNames[confirmSettle.to] || 'User'} image={memberImages[confirmSettle.to]} size="md" />
                        </div>
                        <p style={{ color: 'var(--fg-secondary)', fontSize: 'var(--text-sm)' }}>
                            Mark <strong>{formatCurrency(confirmSettle.amount)}</strong> from{' '}
                            <strong>{memberNames[confirmSettle.from] || 'User'}</strong> to{' '}
                            <strong>{memberNames[confirmSettle.to] || 'User'}</strong> as settled?
                        </p>
                        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                            <Button variant="outline" fullWidth onClick={() => setConfirmSettle(null)}>Cancel</Button>
                            <Button fullWidth loading={settling} onClick={handleMarkAsPaid}
                                style={{
                                    background: 'linear-gradient(135deg, var(--accent-500), var(--accent-600))',
                                    boxShadow: '0 4px 20px rgba(var(--accent-500-rgb), 0.3)',
                                }}
                            >
                                Confirm
                            </Button>
                        </div>
                    </div>
                )}
            </Modal>

            {/* UPI Payment Modal */}
            <UpiPaymentModal
                isOpen={upiModal.open}
                onClose={() => setUpiModal({ open: false, amount: 0, payeeName: '' })}
                settlementId={upiModal.settlementId}
                amount={upiModal.amount}
                payeeName={upiModal.payeeName}
                payeeUpiId={upiModal.payeeUpiId}
                onPaymentComplete={() => {
                    setUpiModal({ open: false, amount: 0, payeeName: '' });
                    setLoading(true);
                    fetchSettlements();
                }}
            />
        </div>
    );
}
