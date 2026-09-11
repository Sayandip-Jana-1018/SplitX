'use client';

import { useMemo, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { motion } from 'framer-motion';
import {
    ArrowDownLeft,
    ArrowRightLeft,
    ArrowUpRight,
    CheckCheck,
    GitBranch,
    PieChart,
    Plus,
    ReceiptText,
    RefreshCw,
    ScanLine,
    Sparkles,
    Users,
    type LucideIcon,
} from 'lucide-react';
import Avatar, { AvatarGroup } from '@/components/ui/Avatar';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import { DashboardSkeleton } from '@/components/ui/Skeleton';
import PullToRefreshIndicator from '@/components/ui/PullToRefreshIndicator';
import { CategoryTile } from '@/components/ui/Icons';
import { Amount, IconTile, ListGroup, ListRow, Section, Stagger, StaggerItem, Tag } from '@/components/ui/kit';
import { useAnimatedNumber } from '@/hooks/useAnimatedNumber';
import { useBalances } from '@/hooks/useBalances';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useHaptics } from '@/hooks/useHaptics';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { fetcher } from '@/lib/swr';
import { getNetworkErrorCopy, NetworkTaggedError } from '@/lib/networkErrors';
import { openAssistant } from '@/lib/uiEvents';
import { cn, formatCurrency, getGreeting, timeAgo } from '@/lib/utils';
import styles from './dashboard.module.css';

interface GroupSummary {
    id: string;
    name: string;
    emoji: string;
    totalSpent?: number;
    members: { user: { id: string; name: string | null; image: string | null } }[];
}

interface TransactionSummary {
    id: string;
    title: string;
    amount: number;
    category: string;
    createdAt: string;
    payer: { id: string; name: string | null } | null;
    splits?: { userId: string; amount: number }[];
}

const QUICK_ACTIONS: { href: string; label: string; icon: LucideIcon; primary?: boolean }[] = [
    { href: '/transactions/new', label: 'Add', icon: Plus, primary: true },
    { href: '/settlements', label: 'Settle', icon: ArrowRightLeft },
    { href: '/transactions/scan', label: 'Scan', icon: ScanLine },
    { href: '/analytics', label: 'Insights', icon: PieChart },
];

const swrOptions = { keepPreviousData: true, revalidateOnFocus: true, dedupingInterval: 5000 };

const subscribeToClock = (onChange: () => void) => {
    const id = window.setInterval(onChange, 60_000);
    return () => window.clearInterval(id);
};

/** Current hour, read on the client only (avoids SSR/CSR time mismatches). */
function useHour() {
    return useSyncExternalStore(subscribeToClock, () => new Date().getHours(), () => 12);
}

const firstName = (name?: string | null) => (name || 'Friend').split(' ')[0];

export default function DashboardPage() {
    const haptics = useHaptics();
    const hour = useHour();
    const greeting = getGreeting(hour);
    const { user } = useCurrentUser();
    const balances = useBalances();
    const [refreshing, setRefreshing] = useState(false);

    const groupsQuery = useSWR<GroupSummary[]>('/api/groups', fetcher, swrOptions);
    const txnsQuery = useSWR<TransactionSummary[]>('/api/transactions?limit=5', fetcher, swrOptions);

    const refreshAll = async () => {
        await Promise.all([groupsQuery.mutate(), txnsQuery.mutate(), balances.mutate()]);
    };

    const { containerRef, pullDistance, refreshing: pulling } = usePullToRefresh({
        onRefresh: async () => {
            haptics.medium();
            await refreshAll();
        },
        activationHeight: 180,
    });

    const handleRefresh = async () => {
        haptics.light();
        setRefreshing(true);
        try {
            await refreshAll();
        } finally {
            setRefreshing(false);
        }
    };

    const groups = useMemo(() => (Array.isArray(groupsQuery.data) ? groupsQuery.data : []), [groupsQuery.data]);
    const transactions = useMemo(() => (Array.isArray(txnsQuery.data) ? txnsQuery.data.slice(0, 5) : []), [txnsQuery.data]);

    const isInitialLoading = (groupsQuery.isLoading && !groupsQuery.data)
        || (txnsQuery.isLoading && !txnsQuery.data)
        || (balances.isLoading && !balances.data);
    const error = [groupsQuery.error, txnsQuery.error, balances.error].find(Boolean) as NetworkTaggedError | undefined;

    const heroName = firstName(user?.name) === 'Friend' ? 'there' : firstName(user?.name);
    const firstGroup = groups[0];

    return (
        <div ref={containerRef} className={styles.page}>
            <PullToRefreshIndicator pullDistance={pullDistance} refreshing={pulling} />

            {isInitialLoading ? (
                <DashboardSkeleton />
            ) : error && !groupsQuery.data ? (
                <ErrorState
                    variant={error.variant}
                    title={getNetworkErrorCopy(error.variant).title}
                    message={getNetworkErrorCopy(error.variant).message}
                    onRetry={handleRefresh}
                />
            ) : (
                <Stagger className={styles.page}>
                    <StaggerItem>
                        <header className={styles.greeting}>
                            <span className={styles.greetingEyebrow}>{greeting.text} {greeting.emoji}</span>
                            <h1 className={styles.greetingName}>Hi, {heroName}</h1>
                        </header>
                    </StaggerItem>

                    <StaggerItem>
                        <BalanceCard
                            net={balances.net}
                            youOwe={balances.youOwe}
                            owedToYou={balances.owedToYou}
                            refreshing={refreshing}
                            onRefresh={handleRefresh}
                        />
                    </StaggerItem>

                    <StaggerItem>
                        <div className={styles.quick} data-tour="quick-actions">
                            {QUICK_ACTIONS.map((action) => {
                                const Icon = action.icon;
                                return (
                                    <Link
                                        key={action.href}
                                        href={action.href}
                                        className={styles.quickItem}
                                        onClick={() => haptics.light()}
                                    >
                                        <motion.span
                                            className={cn(styles.quickIcon, action.primary && styles.quickIconPrimary)}
                                            whileTap={{ scale: 0.9 }}
                                        >
                                            <Icon size={22} strokeWidth={action.primary ? 2.5 : 2} />
                                        </motion.span>
                                        <span className={styles.quickLabel}>{action.label}</span>
                                    </Link>
                                );
                            })}
                        </div>
                    </StaggerItem>

                    <StaggerItem>
                        <Section title="Your groups" action={groups.length ? { label: 'See all', href: '/groups' } : undefined}>
                            {groups.length > 0 ? (
                                <div className={styles.rail}>
                                    <div className={styles.railInner}>
                                        {groups.map((group) => {
                                            const net = balances.byGroup[group.id]?.net ?? 0;
                                            return (
                                                <Link key={group.id} href={`/groups/${group.id}`} className={styles.groupCard}>
                                                    <span className={styles.groupEmoji}>{group.emoji}</span>
                                                    <span className={styles.groupName}>{group.name}</span>
                                                    <span className={styles.groupMeta}>
                                                        {group.members.length} member{group.members.length === 1 ? '' : 's'} · {formatCurrency(group.totalSpent || 0)}
                                                    </span>
                                                    <span className={styles.groupFoot}>
                                                        <AvatarGroup
                                                            users={group.members.map((member) => ({ name: member.user?.name || 'Member', image: member.user?.image }))}
                                                            max={3}
                                                            size="xs"
                                                        />
                                                        {net === 0 ? (
                                                            <Tag>Settled</Tag>
                                                        ) : (
                                                            <Tag tone={net > 0 ? 'success' : 'danger'}>
                                                                {net > 0 ? '+' : '−'}{formatCurrency(Math.abs(net))}
                                                            </Tag>
                                                        )}
                                                    </span>
                                                </Link>
                                            );
                                        })}
                                        <Link href="/groups?create=1" className={cn(styles.groupCard, styles.groupCardNew)}>
                                            <span className={styles.newIcon}><Plus size={20} /></span>
                                            <span className={styles.groupName}>New group</span>
                                            <span className={styles.groupMeta}>Trips, flats, anything</span>
                                        </Link>
                                    </div>
                                </div>
                            ) : (
                                <EmptyState
                                    compact
                                    icon={<Users size={22} />}
                                    title="Start your first group"
                                    description="Create a group for a trip, your flat or a friend circle — then add expenses together."
                                    actionLabel="Create a group"
                                    actionHref="/groups?create=1"
                                />
                            )}
                        </Section>
                    </StaggerItem>

                    <StaggerItem>
                        <Section
                            title="Settle up"
                            action={balances.mine.length ? { label: 'Open', href: '/settlements' } : undefined}
                        >
                            {balances.mine.length > 0 ? (
                                <ListGroup>
                                    {balances.mine.slice(0, 4).map((transfer, index) => {
                                        const iOwe = transfer.from === balances.userId;
                                        const otherName = iOwe ? transfer.toName : transfer.fromName;
                                        const otherImage = iOwe ? transfer.toImage : transfer.fromImage;
                                        return (
                                            <ListRow
                                                key={`${transfer.groupId}-${transfer.from}-${transfer.to}-${index}`}
                                                href="/settlements"
                                                leading={<Avatar name={otherName || 'Friend'} image={otherImage} size="md" />}
                                                title={iOwe ? `You owe ${firstName(otherName)}` : `${firstName(otherName)} owes you`}
                                                subtitle={[transfer.groupEmoji, transfer.groupName].filter(Boolean).join(' ')}
                                                trailing={<Amount value={iOwe ? -transfer.amount : transfer.amount} tone="auto" signed />}
                                                trailingSub={iOwe ? 'Tap to pay' : 'Tap to remind'}
                                            />
                                        );
                                    })}
                                </ListGroup>
                            ) : (
                                <div className={styles.settledCard}>
                                    <span className={styles.settledIcon}><CheckCheck size={20} /></span>
                                    <div>
                                        <p className={styles.settledTitle}>You&apos;re all settled up</p>
                                        <p className={styles.settledText}>Nothing pending across your groups. Nice.</p>
                                    </div>
                                </div>
                            )}
                        </Section>
                    </StaggerItem>

                    <StaggerItem>
                        <Section
                            title="Recent activity"
                            action={transactions.length ? { label: 'See all', href: '/transactions' } : undefined}
                        >
                            {transactions.length > 0 ? (
                                <ListGroup>
                                    {transactions.map((transaction) => {
                                        const share = transaction.splits?.find((split) => split.userId === balances.userId)?.amount;
                                        const payerIsMe = transaction.payer?.id === balances.userId;
                                        return (
                                            <ListRow
                                                key={transaction.id}
                                                href={`/transactions?focus=${transaction.id}`}
                                                leading={<CategoryTile category={transaction.category} />}
                                                title={transaction.title}
                                                subtitle={`${payerIsMe ? 'You' : firstName(transaction.payer?.name)} paid · ${timeAgo(transaction.createdAt)}`}
                                                trailing={<Amount value={transaction.amount} />}
                                                trailingSub={typeof share === 'number' ? `Your share ${formatCurrency(share)}` : 'Not in split'}
                                            />
                                        );
                                    })}
                                </ListGroup>
                            ) : (
                                <EmptyState
                                    compact
                                    icon={<ReceiptText size={22} />}
                                    title="No expenses yet"
                                    description="Add your first expense and it will show up here instantly."
                                    actionLabel="Add expense"
                                    actionHref="/transactions/new"
                                />
                            )}
                        </Section>
                    </StaggerItem>

                    <StaggerItem>
                        <Section title="Explore">
                            <ListGroup>
                                {firstGroup && isFeatureEnabled('balanceJourney') && (
                                    <ListRow
                                        href={`/groups/${firstGroup.id}/journey`}
                                        leading={<IconTile><GitBranch size={18} /></IconTile>}
                                        title="Balance journey"
                                        subtitle={`See why your balance moved in ${firstGroup.name}`}
                                        chevron
                                    />
                                )}
                                <ListRow
                                    href="/analytics"
                                    leading={<IconTile tone="success"><PieChart size={18} /></IconTile>}
                                    title="Spending insights"
                                    subtitle="Trends, categories and who paid what"
                                    chevron
                                />
                                <ListRow
                                    onClick={openAssistant}
                                    leading={<IconTile tone="solid"><Sparkles size={18} /></IconTile>}
                                    title="Ask SplitX AI"
                                    subtitle="“How much did we spend on food?”"
                                    chevron
                                />
                            </ListGroup>
                        </Section>
                    </StaggerItem>
                </Stagger>
            )}
        </div>
    );
}

/* ═══════════════════════════════════════════════════════════════
   Balance hero card
   ═══════════════════════════════════════════════════════════════ */

function BalanceCard({
    net,
    youOwe,
    owedToYou,
    refreshing,
    onRefresh,
}: {
    net: number;
    youOwe: number;
    owedToYou: number;
    refreshing: boolean;
    onRefresh: () => void;
}) {
    const animatedAmount = useAnimatedNumber(Math.abs(net), 1000, (value) => formatCurrency(value));
    const status = net > 0
        ? { label: 'You’re owed overall', icon: <ArrowDownLeft size={15} /> }
        : net < 0
            ? { label: 'You owe overall', icon: <ArrowUpRight size={15} /> }
            : { label: 'All settled up', icon: <CheckCheck size={15} /> };

    return (
        <section className={styles.hero} data-tour="balance" aria-label="Net balance">
            <span className={styles.heroAurora} aria-hidden="true" />
            <span className={styles.heroSheen} aria-hidden="true" />

            <div className={styles.heroTop}>
                <span className={styles.heroLabel}>
                    <span className={styles.heroDot} />
                    Net balance
                </span>
                <button
                    type="button"
                    className={styles.heroRefresh}
                    onClick={onRefresh}
                    disabled={refreshing}
                    aria-label="Refresh balances"
                >
                    <RefreshCw size={15} className={refreshing ? 'spin' : undefined} />
                </button>
            </div>

            <div className={styles.heroAmount}>
                {net !== 0 && <span className={styles.heroSign}>{net > 0 ? '+' : '−'}</span>}
                {animatedAmount}
            </div>
            <div className={styles.heroStatus}>
                {status.icon}
                {status.label}
            </div>

            <div className={styles.heroTiles}>
                <Link href="/settlements" className={styles.heroTile}>
                    <span className={styles.heroTileLabel}>
                        <span className={cn(styles.heroTileIcon, styles.heroTileOut)}><ArrowUpRight size={13} /></span>
                        You owe
                    </span>
                    <span className={styles.heroTileValue}>{formatCurrency(youOwe)}</span>
                </Link>
                <Link href="/settlements" className={styles.heroTile}>
                    <span className={styles.heroTileLabel}>
                        <span className={cn(styles.heroTileIcon, styles.heroTileIn)}><ArrowDownLeft size={13} /></span>
                        Owed to you
                    </span>
                    <span className={styles.heroTileValue}>{formatCurrency(owedToYou)}</span>
                </Link>
            </div>
        </section>
    );
}
