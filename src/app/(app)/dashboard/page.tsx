'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { motion, useScroll, useTransform } from 'framer-motion';
import {
    TrendingUp,
    TrendingDown,
    Users,
    Receipt,
    ArrowRightLeft,
    Plus,
    ArrowRight,
    BarChart3,
    Sparkles,
    Inbox,
    RefreshCw,
    Wallet,
    Zap,
} from 'lucide-react';
import { Card } from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import { AvatarGroup } from '@/components/ui/Avatar';
import { CategoryIcon, PaymentIcon, PAYMENT_ICONS } from '@/components/ui/Icons';
import { DashboardSkeleton } from '@/components/ui/Skeleton';
import { useAnimatedNumber } from '@/hooks/useAnimatedNumber';
import { useHaptics } from '@/hooks/useHaptics';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { useToast } from '@/components/ui/Toast';
import PullToRefreshIndicator from '@/components/ui/PullToRefreshIndicator';
import TiltCard from '@/components/ui/TiltCard';
import ParticleBackground from '@/components/ui/ParticleBackground';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { formatCurrency, timeAgo } from '@/lib/utils';

/* ── Animation helpers ── */
const fadeUp = {
    initial: { opacity: 0, y: 20 },
    animate: { opacity: 1, y: 0 },
};

const staggerContainer = {
    animate: {
        transition: { staggerChildren: 0.08 },
    },
};

const scaleIn = {
    initial: { opacity: 0, scale: 0.92 },
    animate: { opacity: 1, scale: 1 },
};

/* ── Types ── */
interface DashboardStats {
    totalSpent: number;
    youOwe: number;
    youAreOwed: number;
    activeTrips: number;
}

interface Transaction {
    id: string;
    title: string;
    amount: number;
    payer: string;
    category: string;
    method: string;
    time: string;
}

interface Settlement {
    from: string;
    to: string;
    amount: number;
}

interface GroupMember {
    name: string;
    image?: string | null;
}

/* ── Smart Greeting ── */
function useSmartGreeting(): { text: string; emoji: string } {
    const [greeting, setGreeting] = useState({ text: 'Welcome', emoji: '👋' });
    useEffect(() => {
        const hour = new Date().getHours();
        if (hour < 6) setGreeting({ text: 'Good night', emoji: '🌙' });
        else if (hour < 12) setGreeting({ text: 'Good morning', emoji: '🌅' });
        else if (hour < 17) setGreeting({ text: 'Good afternoon', emoji: '🌞' });
        else if (hour < 21) setGreeting({ text: 'Good evening', emoji: '🌇' });
        else setGreeting({ text: 'Good night', emoji: '🌙' });
    }, []);
    return greeting;
}

/* ── Glassmorphic styles ── */
const glassCard: React.CSSProperties = {
    background: 'var(--bg-glass)',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    border: '1px solid var(--border-glass)',
    borderRadius: 'var(--radius-2xl)',
    boxShadow: 'var(--shadow-card)',
    position: 'relative',
    overflow: 'hidden',
};

const glassCardInner: React.CSSProperties = {
    position: 'relative',
    zIndex: 1,
};

export default function DashboardPage() {
    const router = useRouter();
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState<DashboardStats>({ totalSpent: 0, youOwe: 0, youAreOwed: 0, activeTrips: 0 });
    const [recentTxns, setRecentTxns] = useState<Transaction[]>([]);
    const [settlements, setSettlements] = useState<Settlement[]>([]);
    const [members, setMembers] = useState<GroupMember[]>([]);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const { toast } = useToast();
    const haptics = useHaptics();
    const greeting = useSmartGreeting();
    const { user: currentUser } = useCurrentUser();
    const currentUserId = currentUser?.id || '';

    const ptr = usePullToRefresh({
        onRefresh: async () => {
            haptics.medium();
            await fetchDashboardData();
        },
    });

    // Scroll Parallax Logic
    const { scrollY } = useScroll({ container: ptr.containerRef });
    const heroScale = useTransform(scrollY, [0, 200], [1, 0.95]);
    const heroOpacity = useTransform(scrollY, [0, 200], [1, 0.8]);
    const heroY = useTransform(scrollY, [0, 200], [0, 10]);

    const fetchDashboardData = useCallback(async () => {
        try {
            const [groupsRes, txnsRes, settlementsRes] = await Promise.allSettled([
                fetch('/api/groups'),
                fetch('/api/transactions?limit=5'),
                fetch('/api/settlements'),
            ]);

            if (groupsRes.status === 'fulfilled' && groupsRes.value.ok) {
                const groupsData = await groupsRes.value.json();
                const groups = groupsData.groups || groupsData || [];
                setStats(prev => ({ ...prev, activeTrips: groups.length }));
                const allMembers: GroupMember[] = [];
                for (const group of groups) {
                    if (group.members) {
                        for (const m of group.members) {
                            const name = m.user?.name || m.name || 'Unknown';
                            const image = m.user?.image || m.image || null;
                            if (!allMembers.find(am => am.name === name)) {
                                allMembers.push({ name, image });
                            }
                        }
                    }
                }
                setMembers(allMembers);
            }

            if (txnsRes.status === 'fulfilled' && txnsRes.value.ok) {
                const txnsData = await txnsRes.value.json();
                const txns = txnsData.transactions || txnsData || [];
                let totalSpent = 0;
                const recentList: Transaction[] = txns.slice(0, 5).map((t: Record<string, unknown>) => {
                    totalSpent += (t.amount as number) || 0;
                    return {
                        id: (t.id as string) || String(Math.random()),
                        title: (t.description as string) || (t.title as string) || 'Expense',
                        amount: (t.amount as number) || 0,
                        payer: (t.paidBy as { name?: string })?.name || (t.payer as { name?: string })?.name || (typeof t.paidBy === 'string' ? (t.paidBy as string) : null) || (typeof t.payer === 'string' ? (t.payer as string) : null) || 'Unknown',
                        category: (t.category as string) || 'general',
                        method: (t.paymentMethod as string) || 'cash',
                        time: (t.createdAt as string) || new Date().toISOString(),
                    };
                });
                setRecentTxns(recentList);
                setStats(prev => ({ ...prev, totalSpent }));
            }

            if (settlementsRes.status === 'fulfilled' && settlementsRes.value.ok) {
                const settData = await settlementsRes.value.json();
                const pending = Array.isArray(settData.computed) ? settData.computed : [];
                let youOwe = 0;
                let youAreOwed = 0;
                const settList: Settlement[] = pending.map((s: Record<string, unknown>) => {
                    const fromId = (s.from as string) || '';
                    const toId = (s.to as string) || '';
                    const amount = (s.amount as number) || 0;
                    if (currentUserId && fromId === currentUserId) youOwe += amount;
                    if (currentUserId && toId === currentUserId) youAreOwed += amount;
                    return { from: fromId, to: toId, amount };
                });
                setSettlements(settList);
                setStats(prev => ({ ...prev, youOwe, youAreOwed }));
            }
        } catch (err) {
            console.error('Dashboard fetch error:', err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchDashboardData();
    }, [fetchDashboardData]);



    const handleRefresh = async () => {
        setIsRefreshing(true);
        await fetchDashboardData();
        setIsRefreshing(false);
    };

    const hasData = recentTxns.length > 0 || settlements.length > 0 || stats.activeTrips > 0;
    const netBalance = stats.youAreOwed - stats.youOwe;

    return (
        <div ref={ptr.containerRef} style={{ overflow: 'auto', position: 'relative', height: '100%' }}>
            <ParticleBackground count={30} className="fixed inset-0 pointer-events-none" />
            <PullToRefreshIndicator pullDistance={ptr.pullDistance} refreshing={ptr.refreshing} />

            {loading ? (
                <div style={{ padding: 'var(--space-5)' }}>
                    <DashboardSkeleton />
                </div>
            ) : (
                <motion.div
                    style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}
                    initial="initial"
                    animate="animate"
                    variants={staggerContainer}
                >
                    {/* ═══ HERO SECTION — Animated Mesh Gradient Balance Card ═══ */}
                    <motion.div
                        style={{ scale: heroScale, opacity: heroOpacity, y: heroY }}
                        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                    >
                        <TiltCard maxTilt={4} scale={1.01} glare={true}>
                            <div
                                style={{
                                    ...glassCard,
                                    backdropFilter: 'none',
                                    WebkitBackdropFilter: 'none',
                                    padding: 'var(--space-5)',
                                    background: 'linear-gradient(135deg, rgba(var(--accent-500-rgb), 0.15) 0%, var(--bg-glass) 30%, rgba(var(--accent-500-rgb), 0.08) 60%, var(--bg-glass) 100%)',
                                    boxShadow: 'var(--shadow-card), 0 0 60px rgba(var(--accent-500-rgb), 0.1)',
                                }}
                            >
                                <div style={glassCardInner}>
                                    {/* Header row */}
                                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
                                        <div style={{
                                            width: 36, height: 36, borderRadius: 'var(--radius-lg)',
                                            background: 'linear-gradient(135deg, var(--accent-500), var(--accent-600))',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            boxShadow: '0 4px 16px rgba(var(--accent-500-rgb), 0.35)',
                                            color: 'white', marginRight: 'var(--space-3)',
                                        }}>
                                            <Wallet size={18} />
                                        </div>
                                        <div style={{ flex: 1 }}>
                                            <div style={{
                                                fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)',
                                                fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em',
                                            }}>
                                                {greeting.emoji} {greeting.text}
                                            </div>
                                            <div style={{
                                                fontSize: 'var(--text-sm)', fontWeight: 600,
                                                color: 'var(--fg-primary)', marginTop: 1,
                                            }}>
                                                {currentUser?.name || 'Welcome'}
                                            </div>
                                        </div>
                                        <button onClick={handleRefresh} disabled={isRefreshing}
                                            style={{
                                                width: 34, height: 34, borderRadius: 'var(--radius-lg)',
                                                background: 'rgba(var(--accent-500-rgb), 0.08)',
                                                border: '1px solid rgba(var(--accent-500-rgb), 0.12)',
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                color: 'var(--accent-400)', cursor: 'pointer',
                                                opacity: isRefreshing ? 0.5 : 1, transition: 'all 0.2s',
                                            }}
                                            title="Refresh"
                                        >
                                            <RefreshCw size={14} style={{ animation: isRefreshing ? 'spin 1s linear infinite' : 'none' }} />
                                        </button>
                                    </div>

                                    {/* Net balance display */}
                                    <div style={{ textAlign: 'center', padding: 'var(--space-3) 0 var(--space-4)' }}>
                                        <div style={{
                                            fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)', fontWeight: 500,
                                            textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6,
                                        }}>
                                            Net Balance
                                        </div>
                                        <div style={{
                                            fontSize: 'var(--text-4xl)', fontWeight: 800,
                                            background: netBalance >= 0
                                                ? 'linear-gradient(135deg, var(--color-success), #6ee7b7)'
                                                : 'linear-gradient(135deg, var(--color-error), #fca5a5)',
                                            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
                                            lineHeight: 1.1,
                                        }}>
                                            {netBalance >= 0 ? '+' : ''}{formatCurrency(Math.abs(netBalance))}
                                        </div>
                                        <div style={{
                                            fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)', marginTop: 6,
                                        }}>
                                            {netBalance > 0 ? 'You\'re owed overall' : netBalance < 0 ? 'You owe overall' : 'All settled up!'}
                                        </div>
                                    </div>

                                    {/* Owe/Owed mini bar */}
                                    <div style={{
                                        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)',
                                        background: 'rgba(var(--accent-500-rgb), 0.04)',
                                        borderRadius: 'var(--radius-xl)', padding: 'var(--space-3)',
                                        border: '1px solid rgba(var(--accent-500-rgb), 0.06)',
                                    }}>
                                        <div style={{ textAlign: 'center' }}>
                                            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-error)', fontWeight: 500 }}>You Owe</div>
                                            <div style={{ fontSize: 'var(--text-base)', fontWeight: 700, color: 'var(--fg-primary)', marginTop: 2 }}>
                                                {formatCurrency(stats.youOwe)}
                                            </div>
                                        </div>
                                        <div style={{ textAlign: 'center', borderLeft: '1px solid var(--border-subtle)', paddingLeft: 'var(--space-2)' }}>
                                            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-success)', fontWeight: 500 }}>You&apos;re Owed</div>
                                            <div style={{ fontSize: 'var(--text-base)', fontWeight: 700, color: 'var(--fg-primary)', marginTop: 2 }}>
                                                {formatCurrency(stats.youAreOwed)}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </TiltCard>
                    </motion.div>

                    {/* ═══ QUICK STATS ROW — Glassmorphic Chips ═══ */}
                    <motion.div
                        variants={staggerContainer}
                        data-tour="dashboard-stats"
                        style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 'var(--space-3)' }}
                    >
                        <GlassStatCard
                            label="Total Spent" value={stats.totalSpent}
                            icon={<Receipt size={16} />} iconColor="var(--accent-400)"
                            iconBg="rgba(var(--accent-500-rgb), 0.12)"
                        />
                        <GlassStatCard
                            label="Active Groups" value={stats.activeTrips} isCurrency={false}
                            icon={<Users size={16} />} iconColor="var(--accent-400)"
                            iconBg="rgba(var(--accent-500-rgb), 0.12)"
                        />
                    </motion.div>

                    {/* ═══ QUICK ACTIONS — Glass Pill Buttons ═══ */}
                    <motion.div variants={fadeUp} transition={{ duration: 0.5, delay: 0.1 }} data-tour="quick-actions">
                        <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'space-between' }}>
                            {[
                                { label: 'Add Expense', icon: <Plus size={13} />, href: '/transactions/new' },
                                { label: 'Settle Up', icon: <ArrowRightLeft size={13} />, href: '/settlements' },
                                { label: 'Analytics', icon: <BarChart3 size={13} />, href: '/analytics' },
                                { label: 'Groups', icon: <Users size={13} />, href: '/groups' },
                            ].map((action) => (
                                <button
                                    key={action.label}
                                    onClick={() => { haptics.light(); router.push(action.href); }}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: 4,
                                        padding: '6px 10px', borderRadius: 'var(--radius-full)',
                                        background: 'var(--bg-glass)', backdropFilter: 'blur(16px)',
                                        WebkitBackdropFilter: 'blur(16px)',
                                        border: '1px solid var(--border-glass)',
                                        color: 'var(--fg-secondary)', fontSize: '11px', fontWeight: 600,
                                        whiteSpace: 'nowrap', cursor: 'pointer', transition: 'all 0.2s ease',
                                    }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.background = 'rgba(var(--accent-500-rgb), 0.1)';
                                        e.currentTarget.style.color = 'var(--accent-400)';
                                        e.currentTarget.style.borderColor = 'rgba(var(--accent-500-rgb), 0.2)';
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.background = 'var(--bg-glass)';
                                        e.currentTarget.style.color = 'var(--fg-secondary)';
                                        e.currentTarget.style.borderColor = 'var(--border-glass)';
                                    }}
                                >
                                    {action.icon} {action.label}
                                </button>
                            ))}
                        </div>
                    </motion.div>

                    {/* ═══ RECENT TRANSACTIONS ═══ */}
                    <motion.div variants={fadeUp} transition={{ duration: 0.5, delay: 0.15 }}>
                        <SectionHeader title="Recent Activity" action="View All" href="/transactions" />
                        {recentTxns.length > 0 ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                                {recentTxns.map((txn, i) => {
                                    const pay = PAYMENT_ICONS[txn.method] || PAYMENT_ICONS.cash;
                                    return (
                                        <motion.div
                                            key={txn.id}
                                            initial={{ opacity: 0, x: -16 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            transition={{ duration: 0.4, delay: 0.2 + i * 0.06 }}
                                        >
                                            <div style={{
                                                ...glassCard,
                                                borderRadius: 'var(--radius-xl)',
                                                padding: 'var(--space-3) var(--space-4)',
                                                cursor: 'pointer',
                                                transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
                                            }}
                                                onMouseEnter={(e) => {
                                                    e.currentTarget.style.transform = 'translateY(-2px)';
                                                    e.currentTarget.style.boxShadow = 'var(--shadow-card-hover)';
                                                }}
                                                onMouseLeave={(e) => {
                                                    e.currentTarget.style.transform = 'translateY(0)';
                                                    e.currentTarget.style.boxShadow = '';
                                                }}
                                            >
                                                <div style={{ ...glassCardInner, display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                                                    {/* Category icon with accent bg */}
                                                    <div style={{
                                                        width: 40, height: 40, borderRadius: 'var(--radius-lg)',
                                                        background: 'linear-gradient(135deg, rgba(var(--accent-500-rgb), 0.12), rgba(var(--accent-500-rgb), 0.04))',
                                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                        flexShrink: 0,
                                                    }}>
                                                        <CategoryIcon category={txn.category} size={18} />
                                                    </div>
                                                    <div style={{ flex: 1, minWidth: 0 }}>
                                                        <div style={{
                                                            fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--fg-primary)',
                                                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                                        }}>
                                                            {txn.title}
                                                        </div>
                                                        <div style={{
                                                            fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)',
                                                            display: 'flex', gap: 4, alignItems: 'center', marginTop: 2,
                                                            justifyContent: 'center',
                                                        }}>
                                                            <span>{txn.payer}</span>
                                                            <span style={{ opacity: 0.3 }}>·</span>
                                                            <span>{timeAgo(txn.time)}</span>
                                                        </div>
                                                    </div>
                                                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                                                        <div style={{
                                                            fontWeight: 700, fontSize: 'var(--text-sm)',
                                                            background: 'linear-gradient(135deg, var(--accent-400), var(--accent-500))',
                                                            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
                                                        }}>
                                                            {formatCurrency(txn.amount)}
                                                        </div>
                                                        <span style={{
                                                            display: 'inline-flex', alignItems: 'center', gap: 3,
                                                            fontSize: '10px', color: pay.color, marginTop: 2,
                                                        }}>
                                                            <PaymentIcon method={txn.method} size={10} /> {pay.label}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        </motion.div>
                                    );
                                })}
                            </div>
                        ) : (
                            <GlassEmptyState
                                icon={<Inbox size={24} />}
                                title="No transactions yet"
                                subtitle="Add your first expense to start tracking."
                            />
                        )}
                    </motion.div>

                    {/* ═══ SETTLEMENTS ═══ */}
                    <motion.div variants={fadeUp} transition={{ duration: 0.5, delay: 0.25 }}>
                        <SectionHeader title="Pending Settlements" action="Settle Up" href="/settlements" />
                        {settlements.length > 0 ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                                {settlements.map((s, i) => (
                                    <motion.div
                                        key={i}
                                        initial={{ opacity: 0, x: -12 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        transition={{ duration: 0.4, delay: 0.3 + i * 0.06 }}
                                    >
                                        <div style={{
                                            ...glassCard,
                                            borderRadius: 'var(--radius-xl)',
                                            padding: 'var(--space-3) var(--space-4)',
                                            borderColor: s.from === currentUserId
                                                ? 'rgba(239, 68, 68, 0.12)' : 'rgba(16, 185, 129, 0.12)',
                                        }}>
                                            <div style={{ ...glassCardInner, display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                                                <div style={{
                                                    width: 36, height: 36, borderRadius: 'var(--radius-lg)',
                                                    background: s.from === currentUserId
                                                        ? 'linear-gradient(135deg, rgba(239, 68, 68, 0.15), rgba(239, 68, 68, 0.05))'
                                                        : 'linear-gradient(135deg, rgba(16, 185, 129, 0.15), rgba(16, 185, 129, 0.05))',
                                                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                                                }}>
                                                    <ArrowRightLeft size={15} style={{
                                                        color: s.from === currentUserId ? 'var(--color-error)' : 'var(--color-success)',
                                                    }} />
                                                </div>
                                                <div style={{ flex: 1 }}>
                                                    <span style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-primary)', fontWeight: 500 }}>
                                                        {s.from === currentUserId ? (
                                                            <>You → <strong>{s.to}</strong></>
                                                        ) : (
                                                            <><strong>{s.from}</strong> → You</>
                                                        )}
                                                    </span>
                                                </div>
                                                <span style={{
                                                    fontWeight: 700, fontSize: 'var(--text-sm)',
                                                    color: s.from === currentUserId ? 'var(--color-error)' : 'var(--color-success)',
                                                }}>
                                                    {formatCurrency(s.amount)}
                                                </span>
                                            </div>
                                        </div>
                                    </motion.div>
                                ))}
                            </div>
                        ) : (
                            <GlassEmptyState
                                icon={<ArrowRightLeft size={24} />}
                                title="All settled up! 🎉"
                                subtitle="No pending settlements."
                            />
                        )}
                    </motion.div>

                    {/* ═══ QUICK ADD EXPENSE ═══ */}
                    <motion.div variants={fadeUp} transition={{ duration: 0.5, delay: 0.3 }} data-tour="add-expense">
                        <Button
                            variant="primary"
                            fullWidth
                            leftIcon={<Zap size={16} />}
                            onClick={() => {
                                haptics.light();
                                router.push('/transactions/new');
                                toast('Opening expense form...', 'info');
                            }}
                            style={{
                                background: 'linear-gradient(135deg, var(--accent-500), var(--accent-600))',
                                boxShadow: '0 4px 20px rgba(var(--accent-500-rgb), 0.3), 0 0 40px rgba(var(--accent-500-rgb), 0.1)',
                                borderRadius: 'var(--radius-xl)',
                                padding: '14px',
                                fontSize: 'var(--text-sm)',
                                fontWeight: 700,
                            }}
                        >
                            Add New Expense
                        </Button>
                    </motion.div>

                    {/* ═══ ANALYTICS LINK + MEMBERS ═══ */}
                    <motion.div variants={fadeUp} transition={{ duration: 0.5, delay: 0.35 }}>
                        <a href="/analytics" style={{ textDecoration: 'none' }}>
                            <div style={{
                                ...glassCard,
                                borderRadius: 'var(--radius-xl)',
                                padding: 'var(--space-4)',
                                cursor: 'pointer',
                                transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
                            }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.transform = 'translateY(-2px)';
                                    e.currentTarget.style.boxShadow = 'var(--shadow-card-hover)';
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.transform = 'translateY(0)';
                                    e.currentTarget.style.boxShadow = '';
                                }}
                            >
                                <div style={{ ...glassCardInner, display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                                    <div style={{
                                        width: 42, height: 42, borderRadius: 'var(--radius-xl)',
                                        background: 'linear-gradient(135deg, var(--accent-500), var(--accent-600))',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        color: 'white',
                                        boxShadow: '0 4px 16px rgba(var(--accent-500-rgb), 0.3)',
                                    }}>
                                        <BarChart3 size={20} />
                                    </div>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--fg-primary)' }}>
                                            Spending Analytics
                                        </div>
                                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)', marginTop: 2 }}>
                                            Charts &amp; breakdowns
                                        </div>
                                    </div>
                                    <ArrowRight size={16} style={{ color: 'var(--fg-muted)' }} />
                                </div>
                            </div>
                        </a>
                    </motion.div>

                    {/* Trip Members */}
                    {members.length > 0 && (
                        <motion.div variants={fadeUp} transition={{ duration: 0.5, delay: 0.4 }}>
                            <SectionHeader title="Trip Members" />
                            <div style={{ ...glassCard, borderRadius: 'var(--radius-xl)', padding: 'var(--space-4)' }}>
                                <div style={{ ...glassCardInner, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                    <AvatarGroup users={members} max={5} size="md" />
                                    <Button variant="ghost" size="sm" rightIcon={<ArrowRight size={14} />}>
                                        Manage
                                    </Button>
                                </div>
                            </div>
                        </motion.div>
                    )}
                </motion.div>
            )}
        </div>
    );
}

/* ═══════════════════════════════════════════
   Sub-components — Glassmorphic Design
   ═══════════════════════════════════════════ */

function GlassStatCard({
    label, value, icon, iconColor, iconBg, isCurrency = true,
}: {
    label: string; value: number; icon: React.ReactNode;
    iconColor: string; iconBg: string; isCurrency?: boolean;
}) {
    const animatedValue = useAnimatedNumber(
        value, 1400,
        isCurrency ? (val: number) => formatCurrency(val) : undefined
    );

    return (
        <motion.div variants={fadeUp} transition={{ duration: 0.4 }}>
            <div
                className="card-interactive card-highlight noise-overlay"
                style={{
                    background: 'var(--bg-glass)',
                    backdropFilter: 'blur(20px) saturate(1.4)',
                    WebkitBackdropFilter: 'blur(20px) saturate(1.4)',
                    border: '1px solid var(--border-glass)',
                    borderRadius: 'var(--radius-xl)',
                    padding: 'var(--space-4)',
                    boxShadow: 'var(--shadow-card)',
                    position: 'relative',
                    overflow: 'hidden',
                    cursor: 'default',
                }}
            >
                {/* Subtle accent glow in corner */}
                <div style={{
                    position: 'absolute', top: -10, right: -10, width: 60, height: 60,
                    borderRadius: '50%', background: `radial-gradient(circle, rgba(var(--accent-500-rgb), 0.12), transparent)`,
                    pointerEvents: 'none',
                }} />
                <div style={{ position: 'relative', zIndex: 2 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
                        <div style={{
                            width: 32, height: 32, borderRadius: 'var(--radius-md)',
                            background: iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center',
                            color: iconColor,
                            boxShadow: `0 4px 12px ${iconBg}`,
                        }}>
                            {icon}
                        </div>
                        <span style={{
                            fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)', fontWeight: 600,
                            textTransform: 'uppercase', letterSpacing: '0.04em',
                        }}>
                            {label}
                        </span>
                    </div>
                    <div style={{
                        fontSize: 'var(--text-xl)', fontWeight: 800, color: 'var(--fg-primary)',
                        lineHeight: 1.2,
                    }}>
                        {animatedValue}
                    </div>
                </div>
            </div>
        </motion.div>
    );
}

function GlassEmptyState({ icon, title, subtitle }: {
    icon: React.ReactNode; title: string; subtitle: string;
}) {
    return (
        <div
            className="card-highlight noise-overlay"
            style={{
                background: 'var(--bg-glass)',
                backdropFilter: 'blur(16px)',
                WebkitBackdropFilter: 'blur(16px)',
                border: '1px solid var(--border-glass)',
                borderRadius: 'var(--radius-xl)',
                padding: 'var(--space-8) var(--space-4)',
                boxShadow: 'var(--shadow-card)',
                textAlign: 'center',
                position: 'relative',
                overflow: 'hidden',
            }}
        >
            <motion.div
                animate={{ y: [0, -6, 0] }}
                transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
                style={{
                    width: 56, height: 56, borderRadius: 'var(--radius-2xl)',
                    background: 'linear-gradient(135deg, rgba(var(--accent-500-rgb), 0.12), rgba(var(--accent-500-rgb), 0.04))',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    margin: '0 auto var(--space-4)',
                    color: 'var(--accent-400)',
                    boxShadow: '0 8px 24px rgba(var(--accent-500-rgb), 0.1)',
                    position: 'relative',
                    zIndex: 2,
                }}
            >
                {icon}
            </motion.div>
            <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--fg-primary)', marginBottom: 6, position: 'relative', zIndex: 2 }}>
                {title}
            </div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)', lineHeight: 1.5, position: 'relative', zIndex: 2 }}>
                {subtitle}
            </div>
        </div>
    );
}

function SectionHeader({ title, action, href }: {
    title: string; action?: string; href?: string;
}) {
    return (
        <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginBottom: 'var(--space-3)',
        }}>
            <h3
                className="gradient-text"
                style={{
                    fontSize: 'var(--text-sm)', fontWeight: 700,
                    textTransform: 'uppercase', letterSpacing: '0.04em',
                }}
            >
                {title}
            </h3>
            {action && href && (
                <a href={href} style={{
                    fontSize: 'var(--text-xs)', color: 'var(--accent-400)', fontWeight: 600,
                    display: 'flex', alignItems: 'center', gap: 3, transition: 'color 0.2s',
                    textDecoration: 'none',
                }}>
                    {action} <ArrowRight size={12} />
                </a>
            )}
        </div>
    );
}
