'use client';

import { useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence, PanInfo } from 'framer-motion';
import useSWR from 'swr';
import { ArrowRightLeft, Check, Download, Share2, GitBranch, Inbox, CreditCard, Bell, ChevronLeft, ChevronRight } from 'lucide-react';
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

/* ── SWR fetcher ── */
const fetcher = (url: string) => fetch(url).then(r => r.ok ? r.json() : null);

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
interface ComputedTransfer {
    from: string; to: string; amount: number;
    fromName?: string; toName?: string;
    fromImage?: string | null; toImage?: string | null;
    toUpiId?: string | null;
}
interface RecordedSettlement {
    id: string; fromId: string; toId: string; amount: number;
    status: string; method: string | null; note: string | null;
    from: UserRef; to: UserRef; createdAt: string;
}
interface GroupData {
    groupId: string; groupName: string; groupEmoji: string; tripId: string;
    members: { id: string; name: string; image: string | null }[];
    computed: ComputedTransfer[];
    recorded: RecordedSettlement[];
}
interface ByGroupResponse {
    groups: GroupData[];
    global: { computed: ComputedTransfer[]; recorded: RecordedSettlement[] };
}

/* ── Main component ── */
export default function SettlementsPage() {
    const { user: currentUser } = useCurrentUser();
    const { toast } = useToast();
    const [activeSlide, setActiveSlide] = useState(0); // 0 = "All", 1..N = per-group
    const [tab, setTab] = useState<'pending' | 'settled'>('pending');
    const [confirmSettle, setConfirmSettle] = useState<{ from: string; to: string; amount: number; tripId: string } | null>(null);
    const [settling, setSettling] = useState(false);
    const [upiModal, setUpiModal] = useState<{ open: boolean; amount: number; payeeName: string; payeeUpiId?: string; settlementId?: string }>({ open: false, amount: 0, payeeName: '' });

    // SWR data fetching — single call replaces N+2 waterfall
    const { data, isLoading, mutate } = useSWR<ByGroupResponse>('/api/settlements/by-group', fetcher);

    const currentUserId = currentUser?.id || null;

    // Derive all computed values from SWR data
    const { slides, nameMap, imageMap, activePending, activeSettled } = useMemo(() => {
        const groups = data?.groups || [];
        const globalComputed = data?.global?.computed || [];
        const globalRecorded = data?.global?.recorded || [];

        // Build name/image maps
        const nMap: Record<string, string> = {};
        const iMap: Record<string, string | null> = {};
        for (const g of groups) {
            for (const m of g.members) {
                nMap[m.id] = m.name;
                iMap[m.id] = m.image;
            }
        }

        // Slide 0 = "All Groups" global view
        const slideData = [
            {
                label: 'All Groups',
                emoji: '🌐',
                computed: globalComputed,
                recorded: globalRecorded,
                members: [] as { id: string; name: string; image: string | null }[],
                tripId: '',
                groupId: '',
            },
            ...groups.map(g => ({
                label: g.groupName,
                emoji: g.groupEmoji,
                computed: g.computed,
                recorded: g.recorded,
                members: g.members,
                tripId: g.tripId,
                groupId: g.groupId,
            })),
        ];

        // Build pending/settled lists
        const buildPending = (computed: ComputedTransfer[], tripId: string) =>
            computed.map((t, i) => ({
                id: `computed-${tripId}-${i}`,
                from: { name: nMap[t.from] || t.fromName || t.from, id: t.from, image: t.fromImage || iMap[t.from] || null },
                to: { name: nMap[t.to] || t.toName || t.to, id: t.to, image: t.toImage || iMap[t.to] || null },
                amount: t.amount,
                status: 'pending' as const,
                toUpiId: t.toUpiId || null,
                tripId,
            }));

        const buildSettled = (recorded: RecordedSettlement[]) =>
            recorded
                .filter(r => ['completed', 'confirmed', 'paid_pending'].includes(r.status))
                .map(r => ({
                    id: r.id,
                    from: { name: r.from.name || 'Unknown', id: r.fromId, image: r.from.image || null },
                    to: { name: r.to.name || 'Unknown', id: r.toId, image: r.to.image || null },
                    amount: r.amount,
                    status: 'settled' as const,
                    toUpiId: null as string | null,
                    tripId: '',
                }));

        const allP = buildPending(globalComputed, '');
        // Resolve tripId for global settlements — find any group where BOTH users are members
        for (const s of allP) {
            if (!s.tripId) {
                const matchGroup = slideData.find(sl => sl.tripId &&
                    sl.members.some(m => m.id === s.from.id) &&
                    sl.members.some(m => m.id === s.to.id)
                );
                if (matchGroup) s.tripId = matchGroup.tripId;
            }
        }
        const allS = buildSettled(globalRecorded);

        const active = slideData[activeSlide] || slideData[0];
        const aP = activeSlide === 0 ? allP : buildPending(active.computed, active.tripId);
        const aS = activeSlide === 0 ? allS : buildSettled(active.recorded);

        return {
            slides: slideData,
            nameMap: nMap,
            imageMap: iMap,
            allPending: allP,
            allSettled: allS,
            activePending: aP,
            activeSettled: aS,
        };
    }, [data, activeSlide]);

    const filteredSettlements = tab === 'pending' ? activePending : activeSettled;

    const totalYouOwe = activePending.filter(s => s.from.id === currentUserId).reduce((sum, s) => sum + s.amount, 0);
    const totalOwedToYou = activePending.filter(s => s.to.id === currentUserId).reduce((sum, s) => sum + s.amount, 0);

    // Carousel navigation
    const slideCount = slides.length;
    const goToSlide = useCallback((idx: number) => {
        setActiveSlide(Math.max(0, Math.min(idx, slideCount - 1)));
    }, [slideCount]);

    const handleDragEnd = useCallback((_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
        const threshold = 50;
        if (info.offset.x < -threshold && activeSlide < slideCount - 1) {
            setActiveSlide(prev => prev + 1);
        } else if (info.offset.x > threshold && activeSlide > 0) {
            setActiveSlide(prev => prev - 1);
        }
    }, [activeSlide, slideCount]);

    // Build graph data for the active group slide
    const activeSlideData = slides[activeSlide];
    const graphMembers = activeSlideData?.members?.map(m => m.name) || [];
    const graphSettlements = (activeSlideData?.computed || []).map(s => ({
        from: nameMap[s.from] || s.fromName || s.from,
        to: nameMap[s.to] || s.toName || s.to,
        amount: s.amount,
    }));
    const graphMemberImages: Record<string, string | null> = {};
    for (const m of activeSlideData?.members || []) {
        graphMemberImages[m.name] = m.image;
    }

    // Handle mark as paid
    const handleMarkAsPaid = async () => {
        if (!confirmSettle) return;
        const tripId = confirmSettle.tripId || activeSlideData?.tripId;
        if (!tripId) {
            toast('No active trip found — please add an expense first', 'error');
            return;
        }
        setSettling(true);
        try {
            const res = await fetch('/api/settlements', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    tripId, toUserId: confirmSettle.to,
                    amount: confirmSettle.amount, method: 'cash',
                }),
            });
            if (res.ok) {
                toast('Settlement recorded ✅', 'success');
                setConfirmSettle(null);
                mutate();
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

    if (isLoading) return <SettlementSkeleton />;

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

            {/* ═══ GROUP CAROUSEL ═══ */}
            {slides.length > 1 && (
                <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, duration: 0.5 }}>
                    {/* Carousel Navigation Header */}
                    <div style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        marginBottom: 'var(--space-3)',
                    }}>
                        <button
                            onClick={() => goToSlide(activeSlide - 1)}
                            disabled={activeSlide === 0}
                            style={{
                                background: 'none', border: 'none', padding: 6,
                                color: activeSlide === 0 ? 'var(--fg-muted)' : 'var(--fg-secondary)',
                                cursor: activeSlide === 0 ? 'default' : 'pointer',
                                opacity: activeSlide === 0 ? 0.3 : 1,
                                transition: 'all 0.2s',
                            }}
                        >
                            <ChevronLeft size={18} />
                        </button>

                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: '18px' }}>{activeSlideData?.emoji}</span>
                            <span style={{
                                fontSize: 'var(--text-sm)', fontWeight: 700,
                                color: 'var(--fg-primary)',
                            }}>
                                {activeSlideData?.label}
                            </span>
                            <span style={{
                                fontSize: 'var(--text-xs)', color: 'var(--fg-muted)', fontWeight: 500,
                            }}>
                                {activeSlide + 1}/{slideCount}
                            </span>
                        </div>

                        <button
                            onClick={() => goToSlide(activeSlide + 1)}
                            disabled={activeSlide === slideCount - 1}
                            style={{
                                background: 'none', border: 'none', padding: 6,
                                color: activeSlide === slideCount - 1 ? 'var(--fg-muted)' : 'var(--fg-secondary)',
                                cursor: activeSlide === slideCount - 1 ? 'default' : 'pointer',
                                opacity: activeSlide === slideCount - 1 ? 0.3 : 1,
                                transition: 'all 0.2s',
                            }}
                        >
                            <ChevronRight size={18} />
                        </button>
                    </div>

                    {/* Dot Indicators */}
                    <div style={{
                        display: 'flex', justifyContent: 'center', gap: 6,
                        marginBottom: 'var(--space-3)',
                    }}>
                        {slides.map((slide, idx) => (
                            <button
                                key={slide.groupId || 'all'}
                                onClick={() => goToSlide(idx)}
                                style={{
                                    width: idx === activeSlide ? 20 : 8,
                                    height: 8,
                                    borderRadius: 100,
                                    border: 'none',
                                    cursor: 'pointer',
                                    padding: 0,
                                    background: idx === activeSlide
                                        ? 'linear-gradient(135deg, var(--accent-400), var(--accent-600))'
                                        : 'var(--fg-muted)',
                                    opacity: idx === activeSlide ? 1 : 0.3,
                                    transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
                                }}
                                aria-label={`Go to ${slide.label}`}
                            />
                        ))}
                    </div>

                    {/* Swipeable Graph Card */}
                    <div style={{ overflow: 'hidden', borderRadius: 'var(--radius-2xl)' }}>
                        <AnimatePresence mode="wait" initial={false}>
                            <motion.div
                                key={activeSlide}
                                initial={{ opacity: 0, x: 40 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: -40 }}
                                transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                                drag="x"
                                dragConstraints={{ left: 0, right: 0 }}
                                dragElastic={0.15}
                                onDragEnd={handleDragEnd}
                                style={{ cursor: 'grab', touchAction: 'pan-y' }}
                            >
                                {activeSlide === 0 ? (
                                    /* Global Summary Card */
                                    <div style={{
                                        ...glass, borderRadius: 'var(--radius-2xl)', padding: 'var(--space-4)',
                                        background: 'linear-gradient(135deg, rgba(var(--accent-500-rgb), 0.06), var(--bg-glass))',
                                    }}>
                                        <div style={{
                                            display: 'flex', alignItems: 'center', gap: 8,
                                            marginBottom: 'var(--space-3)',
                                            fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)', fontWeight: 600,
                                            textTransform: 'uppercase', letterSpacing: '0.05em',
                                        }}>
                                            <GitBranch size={12} />
                                            Global Pairwise Summary
                                        </div>
                                        {activePending.length > 0 ? (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                                                {activePending.map((s, i) => {
                                                    const isSender = s.from.id === currentUserId;
                                                    const isReceiver = s.to.id === currentUserId;
                                                    return (
                                                        <div key={i} style={{
                                                            display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
                                                            padding: '10px 12px', borderRadius: 'var(--radius-lg)',
                                                            background: isSender
                                                                ? 'rgba(239, 68, 68, 0.04)'
                                                                : isReceiver
                                                                    ? 'rgba(16, 185, 129, 0.04)'
                                                                    : 'rgba(var(--accent-500-rgb), 0.03)',
                                                            border: `1px solid ${isSender ? 'rgba(239, 68, 68, 0.08)' : isReceiver ? 'rgba(16, 185, 129, 0.08)' : 'var(--border-glass)'}`,
                                                        }}>
                                                            <Avatar name={s.from.name} image={s.from.image} size="xs" />
                                                            <ArrowRightLeft size={11} style={{ color: 'var(--fg-muted)', flexShrink: 0 }} />
                                                            <Avatar name={s.to.name} image={s.to.image} size="xs" />
                                                            <div style={{ flex: 1 }}>
                                                                <span style={{
                                                                    fontSize: 'var(--text-xs)', fontWeight: 600,
                                                                    color: isSender ? 'var(--color-error)' : isReceiver ? 'var(--color-success)' : 'var(--fg-primary)',
                                                                }}>
                                                                    {isSender ? 'You' : s.from.name}
                                                                </span>
                                                                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-muted)', margin: '0 4px' }}>→</span>
                                                                <span style={{
                                                                    fontSize: 'var(--text-xs)', fontWeight: 600,
                                                                    color: isReceiver ? 'var(--color-success)' : 'var(--fg-primary)',
                                                                }}>
                                                                    {isReceiver ? 'You' : s.to.name}
                                                                </span>
                                                            </div>
                                                            <span style={{
                                                                fontSize: 'var(--text-sm)', fontWeight: 800,
                                                                color: isSender ? 'var(--color-error)' : isReceiver ? 'var(--color-success)' : 'var(--fg-primary)',
                                                            }}>
                                                                {formatCurrency(s.amount)}
                                                            </span>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        ) : (
                                            <div style={{ textAlign: 'center', padding: 'var(--space-6) 0', color: 'var(--fg-tertiary)', fontSize: 'var(--text-sm)' }}>
                                                All settled up! 🎉
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    /* Per-Group Graph Card */
                                    <div style={{
                                        ...glass, borderRadius: 'var(--radius-2xl)', padding: 'var(--space-3)',
                                        background: 'linear-gradient(135deg, rgba(var(--accent-500-rgb), 0.04), var(--bg-glass))',
                                    }}>
                                        {graphSettlements.length > 0 ? (
                                            <>
                                                <div style={{
                                                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                                    marginBottom: 'var(--space-2)',
                                                    padding: '0 var(--space-1)',
                                                }}>
                                                    <span style={{
                                                        fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)',
                                                        fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em',
                                                        display: 'flex', alignItems: 'center', gap: 6,
                                                    }}>
                                                        <GitBranch size={12} />
                                                        Simplified Transfers
                                                    </span>
                                                    <span style={{
                                                        fontSize: '10px', color: 'var(--fg-muted)',
                                                        background: 'rgba(var(--accent-500-rgb), 0.08)',
                                                        padding: '2px 8px', borderRadius: 100, fontWeight: 600,
                                                    }}>
                                                        {graphSettlements.length} transfer{graphSettlements.length !== 1 ? 's' : ''}
                                                    </span>
                                                </div>
                                                <SettlementGraph
                                                    members={graphMembers}
                                                    settlements={graphSettlements}
                                                    memberImages={graphMemberImages}
                                                    compact
                                                    instanceId={activeSlideData?.groupId || 'group'}
                                                />
                                            </>
                                        ) : (
                                            <div style={{ textAlign: 'center', padding: 'var(--space-8) 0' }}>
                                                <div style={{
                                                    width: 48, height: 48, borderRadius: 'var(--radius-2xl)',
                                                    background: 'rgba(16, 185, 129, 0.08)',
                                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                    margin: '0 auto var(--space-3)', color: '#10b981',
                                                }}>
                                                    <Check size={20} />
                                                </div>
                                                <div style={{ fontWeight: 600, color: 'var(--fg-primary)', marginBottom: 4, fontSize: 'var(--text-sm)' }}>
                                                    All settled up! 🎉
                                                </div>
                                                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)' }}>
                                                    No pending transfers in this group.
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </motion.div>
                        </AnimatePresence>
                    </div>
                </motion.div>
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
                        {t === 'pending' ? `Pending (${activePending.length})` : `Settled (${activeSettled.length})`}
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
                    const tripId = settlement.tripId || activeSlideData?.tripId || '';

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
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
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
                                    <div style={{ fontSize: 10, color: 'red' }}>tripId: {settlement.tripId || 'NONE'}</div>
                                    <span style={{
                                        fontSize: 'var(--text-lg)', fontWeight: 800,
                                        color: isSender
                                            ? 'var(--color-error)'
                                            : isReceiver
                                                ? 'var(--color-success)'
                                                : 'var(--fg-primary)',
                                    }}>
                                        {formatCurrency(settlement.amount)}
                                    </span>
                                </div>

                                {/* Actions */}
                                {!isSettled && (
                                    <div style={{ textAlign: 'center', width: '100%' }}>
                                        {isSender && (
                                            <Button size="sm" leftIcon={<CreditCard size={13} />}
                                                style={{
                                                    background: 'linear-gradient(135deg, #4CAF50, #2E7D32)',
                                                    boxShadow: '0 4px 16px rgba(76,175,80,0.25)',
                                                }}
                                                onClick={async () => {
                                                    const resolvedTripId = settlement.tripId || tripId;
                                                    if (!resolvedTripId) { toast('No active trip — add an expense first', 'error'); return; }
                                                    try {
                                                        const res = await fetch('/api/settlements', {
                                                            method: 'POST',
                                                            headers: { 'Content-Type': 'application/json' },
                                                            body: JSON.stringify({
                                                                tripId: resolvedTripId,
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
                                                onClick={() => setConfirmSettle({ from: settlement.from.id, to: settlement.to.id, amount: settlement.amount, tripId })}
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
            {activePending.length > 0 && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }}>
                    <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                        <button
                            onClick={() => {
                                const data = {
                                    groupName: activeSlideData?.label || 'Group', tripName: 'Trip',
                                    members: graphMembers.map(m => ({ name: m })),
                                    transactions: [], settlements: graphSettlements,
                                    totalSpent: activePending.reduce((sum, s) => sum + s.amount, 0),
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
                                    groupName: activeSlideData?.label || 'Group', tripName: 'Trip',
                                    members: graphMembers.map(m => ({ name: m })),
                                    transactions: [], settlements: graphSettlements,
                                    totalSpent: activePending.reduce((sum, s) => sum + s.amount, 0),
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
                            <Avatar name={nameMap[confirmSettle.from] || 'User'} image={imageMap[confirmSettle.from]} size="md" />
                            <ArrowRightLeft size={20} style={{ color: 'var(--fg-muted)' }} />
                            <Avatar name={nameMap[confirmSettle.to] || 'User'} image={imageMap[confirmSettle.to]} size="md" />
                        </div>
                        <p style={{ color: 'var(--fg-secondary)', fontSize: 'var(--text-sm)' }}>
                            Mark <strong>{formatCurrency(confirmSettle.amount)}</strong> from{' '}
                            <strong>{nameMap[confirmSettle.from] || 'User'}</strong> to{' '}
                            <strong>{nameMap[confirmSettle.to] || 'User'}</strong> as settled?
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
                    mutate();
                }}
            />
        </div>
    );
}
