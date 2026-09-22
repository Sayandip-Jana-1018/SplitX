'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import {
    ArrowDownLeft,
    ArrowRight,
    ArrowUpRight,
    Banknote,
    Bell,
    CheckCheck,
    ChevronDown,
    Clock,
    CreditCard,
    Download,
    GitBranch,
    Globe,
    Info,
    Share2,
    ShieldAlert,
    Users,
    X,
} from 'lucide-react';
import Avatar from '@/components/ui/Avatar';
import Button from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import Modal from '@/components/ui/Modal';
import { SettlementSkeleton } from '@/components/ui/Skeleton';
import { Chip, ChipRow, IconTile, Notice, Segmented, Stagger, StaggerItem, Tag } from '@/components/ui/kit';
import SettlementGraph from '@/components/features/SettlementGraph';
import UpiPaymentModal from '@/components/features/UpiPaymentModal';
import { useToast } from '@/components/ui/Toast';
import { useBalances, type GroupBalanceData } from '@/hooks/useBalances';
import { useHaptics } from '@/hooks/useHaptics';
import { usePerformanceMode } from '@/hooks/usePerformanceMode';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { getNetworkErrorCopy, NetworkTaggedError } from '@/lib/networkErrors';
import { exportAsText, shareSettlement } from '@/lib/export';
import { refreshMoneyData } from '@/lib/swr';
import { cn, formatCurrency, formatDate, PAYMENT_METHODS } from '@/lib/utils';
import {
    canInitiateSettlementPayment,
    isAwaitingReceiverApproval,
    isCompletedSettlementStatus,
    isPendingSettlementStatus,
} from '@/lib/settlementStatus';
import styles from './settlements.module.css';

interface PersonRef {
    id: string;
    name: string;
    image: string | null;
}

interface TransferItem {
    id: string;
    source: 'computed' | 'recorded';
    from: PersonRef;
    to: PersonRef;
    amount: number;
    status: string;
    toUpiId: string | null;
    tripId: string;
    groupId: string;
    groupName: string;
    groupEmoji: string;
    settlementId?: string;
    method?: string | null;
    createdAt?: string;
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const firstName = (name?: string | null) => (name || 'Someone').split(' ')[0];

/** Balances are a group's across all its trips, so a payment is the same payment on any of them. */
function transferKey(fromId: string, toId: string, amount: number) {
    return `${fromId}:${toId}:${amount}`;
}

function buildItems(groups: GroupBalanceData[], scope: string) {
    const scoped = scope === 'all' ? groups : groups.filter((group) => group.groupId === scope);
    const pending: TransferItem[] = [];
    const settled: TransferItem[] = [];

    for (const group of scoped) {
        const person = (id: string, fallbackName?: string | null, fallbackImage?: string | null): PersonRef => {
            const member = group.members.find((entry) => entry.id === id);
            return { id, name: member?.name || fallbackName || 'Member', image: member?.image ?? fallbackImage ?? null };
        };

        const inFlight = group.recorded
            .filter((settlement) => isPendingSettlementStatus(settlement.status))
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        const inFlightKeys = new Set(inFlight.map((settlement) =>
            transferKey(settlement.fromId, settlement.toId, settlement.amount)
        ));

        for (const settlement of inFlight) {
            pending.push({
                id: settlement.id,
                source: 'recorded',
                settlementId: settlement.id,
                from: person(settlement.fromId, settlement.from.name, settlement.from.image),
                to: person(settlement.toId, settlement.to.name, settlement.to.image),
                amount: settlement.amount,
                status: settlement.status,
                toUpiId: null,
                tripId: settlement.tripId || group.tripId,
                groupId: group.groupId,
                groupName: group.groupName,
                groupEmoji: group.groupEmoji,
                method: settlement.method,
                createdAt: settlement.createdAt,
            });
        }

        group.computed.forEach((transfer, index) => {
            const tripId = transfer.tripId || group.tripId;
            if (inFlightKeys.has(transferKey(transfer.from, transfer.to, transfer.amount))) return;
            pending.push({
                id: `computed-${group.groupId}-${index}`,
                source: 'computed',
                from: person(transfer.from, transfer.fromName, transfer.fromImage),
                to: person(transfer.to, transfer.toName, transfer.toImage),
                amount: transfer.amount,
                status: 'pending',
                toUpiId: transfer.toUpiId || null,
                tripId,
                groupId: group.groupId,
                groupName: group.groupName,
                groupEmoji: group.groupEmoji,
            });
        });

        for (const settlement of group.recorded.filter((entry) => isCompletedSettlementStatus(entry.status))) {
            settled.push({
                id: settlement.id,
                source: 'recorded',
                settlementId: settlement.id,
                from: person(settlement.fromId, settlement.from.name, settlement.from.image),
                to: person(settlement.toId, settlement.to.name, settlement.to.image),
                amount: settlement.amount,
                status: settlement.status,
                toUpiId: null,
                tripId: settlement.tripId || group.tripId,
                groupId: group.groupId,
                groupName: group.groupName,
                groupEmoji: group.groupEmoji,
                method: settlement.method,
                createdAt: settlement.createdAt,
            });
        }
    }

    settled.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
    return { pending, settled };
}

export default function SettlementsPage() {
    const router = useRouter();
    const { toast } = useToast();
    const haptics = useHaptics();
    const { mode } = usePerformanceMode();
    const { data, error, isLoading, mutate, userId } = useBalances();

    const [scope, setScope] = useState<string | null>(null);
    const [tab, setTab] = useState<'pending' | 'settled'>('pending');
    const [busyId, setBusyId] = useState<string | null>(null);
    const [flowOpen, setFlowOpen] = useState(true);
    const [cashConfirm, setCashConfirm] = useState<TransferItem | null>(null);
    const [upi, setUpi] = useState<{ open: boolean; amount: number; payeeName: string; payeeUpiId?: string; settlementId?: string }>({
        open: false,
        amount: 0,
        payeeName: '',
    });

    const groups = useMemo(() => data?.groups ?? [], [data]);

    const defaultScope = useMemo(() => {
        if (groups.length === 0) return 'all';
        const involvesMe = groups.find((group) =>
            group.computed.some((transfer) => transfer.from === userId || transfer.to === userId)
            || group.recorded.some((settlement) => isPendingSettlementStatus(settlement.status) && (settlement.fromId === userId || settlement.toId === userId))
        );
        return (involvesMe ?? groups[0]).groupId;
    }, [groups, userId]);

    const activeScope = scope && (scope === 'all' || groups.some((group) => group.groupId === scope)) ? scope : defaultScope;
    const activeGroup = groups.find((group) => group.groupId === activeScope) ?? null;
    const isGlobal = activeScope === 'all';

    const { pending, settled } = useMemo(() => buildItems(groups, activeScope), [activeScope, groups]);
    const visible = tab === 'pending' ? pending : settled;
    const youOwe = pending.filter((item) => item.from.id === userId).reduce((sum, item) => sum + item.amount, 0);
    const owedToYou = pending.filter((item) => item.to.id === userId).reduce((sum, item) => sum + item.amount, 0);
    const net = owedToYou - youOwe;

    const refresh = async () => {
        await Promise.all([mutate(), refreshMoneyData()]);
    };

    const runAction = async (item: TransferItem, action: () => Promise<boolean>) => {
        setBusyId(item.id);
        try {
            const changed = await action();
            if (changed) {
                haptics.success();
                await refresh();
            }
        } catch {
            toast('Network error — please try again', 'error');
        } finally {
            setBusyId(null);
        }
    };

    const createSettlement = async (item: TransferItem, method: string, asReceiver = false) => {
        const res = await fetch('/api/settlements', {
            method: 'POST',
            headers: JSON_HEADERS,
            body: JSON.stringify({
                tripId: item.tripId,
                toUserId: item.to.id,
                amount: item.amount,
                method,
                ...(asReceiver ? { fromUserId: item.from.id } : {}),
            }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
            toast(typeof body.error === 'string' ? body.error : 'Could not start this settlement', 'error');
            return null;
        }
        return body.id as string;
    };

    const payViaUpi = (item: TransferItem) => runAction(item, async () => {
        let settlementId = item.settlementId;
        if (!settlementId) {
            settlementId = (await createSettlement(item, 'upi')) ?? undefined;
            if (!settlementId) return false;
        }
        setUpi({ open: true, amount: item.amount, payeeName: item.to.name, payeeUpiId: item.toUpiId || undefined, settlementId });
        return false;
    });

    const markPaidInCash = (item: TransferItem) => runAction(item, async () => {
        let settlementId = item.settlementId;
        if (!settlementId) {
            settlementId = (await createSettlement(item, 'cash')) ?? undefined;
            if (!settlementId) return false;
        }
        const res = await fetch(`/api/settlements/${settlementId}/confirm`, {
            method: 'POST',
            headers: JSON_HEADERS,
            body: JSON.stringify({ action: 'paid', method: 'cash' }),
        });
        setCashConfirm(null);
        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            toast(typeof body.error === 'string' ? body.error : 'Could not mark this as paid', 'error');
            return true;
        }
        toast(`Marked as paid — ${firstName(item.to.name)} will confirm receipt`, 'success');
        return true;
    });

    const respondToPayment = (item: TransferItem, action: 'approve' | 'reject') => runAction(item, async () => {
        const res = await fetch(`/api/settlements/${item.settlementId}/approve`, {
            method: 'POST',
            headers: JSON_HEADERS,
            body: JSON.stringify({ action }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
            toast(body.error || 'Could not update this payment', 'error');
            return false;
        }
        toast(body.message || (action === 'approve' ? 'Payment approved' : 'Sent back to the payer'), 'success');
        return true;
    });

    const acceptCash = (item: TransferItem) => runAction(item, async () => {
        let settlementId = item.settlementId;
        if (!settlementId) {
            settlementId = (await createSettlement(item, 'cash', true)) ?? undefined;
            if (!settlementId) return false;
        }
        const res = await fetch(`/api/settlements/${settlementId}/confirm-by-receiver`, {
            method: 'POST',
            headers: JSON_HEADERS,
            body: JSON.stringify({ action: 'accept_cash' }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
            toast(body.error || 'Could not record the cash payment', 'error');
            return false;
        }
        toast(`Cash from ${firstName(item.from.name)} recorded`, 'success');
        return true;
    });

    const declineRequest = (item: TransferItem) => runAction(item, async () => {
        const res = await fetch(`/api/settlements/${item.settlementId}/confirm-by-receiver`, {
            method: 'POST',
            headers: JSON_HEADERS,
            body: JSON.stringify({ action: 'reject' }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
            toast(body.error || 'Could not decline this request', 'error');
            return false;
        }
        toast(`Marked as not paid — ${firstName(item.from.name)} was notified`, 'success');
        return true;
    });

    const remind = (item: TransferItem) => runAction(item, async () => {
        haptics.light();
        const res = await fetch('/api/notifications', {
            method: 'POST',
            headers: JSON_HEADERS,
            body: JSON.stringify({
                userId: item.from.id,
                type: 'payment_reminder',
                title: 'Payment reminder',
                body: `${item.to.name} is reminding you to pay ${formatCurrency(item.amount)}`,
                link: '/settlements',
            }),
        });
        toast(res.ok ? `Reminder sent to ${firstName(item.from.name)}` : 'Could not send the reminder', res.ok ? 'success' : 'error');
        return false;
    });

    const exportPayload = () => ({
        groupName: activeGroup?.groupName || 'Group',
        tripName: activeGroup?.groupName || 'Trip',
        members: (activeGroup?.members || []).map((member) => ({ name: member.name })),
        transactions: [],
        settlements: pending.map((item) => ({ from: item.from.name, to: item.to.name, amount: item.amount })),
        totalSpent: pending.reduce((sum, item) => sum + item.amount, 0),
        exportDate: new Date(),
    });

    if (isLoading && !data) return <SettlementSkeleton />;

    if (error instanceof NetworkTaggedError && !data) {
        const copy = getNetworkErrorCopy(error.variant);
        return <ErrorState variant={error.variant} title={copy.title} message={copy.message} onRetry={() => mutate()} />;
    }

    if (groups.length === 0) {
        return (
            <div className={styles.page}>
                <EmptyState
                    icon={<Users size={26} />}
                    title="Nothing to settle yet"
                    description="Once you add expenses in a group, SplitX works out the fewest payments to square everyone up."
                    actionLabel="Go to groups"
                    actionHref="/groups"
                />
            </div>
        );
    }

    const graphMembers = activeGroup?.members.map((member) => member.name) ?? [];
    const graphImages: Record<string, string | null> = {};
    for (const member of activeGroup?.members ?? []) graphImages[member.name] = member.image;
    const graphSettlements = (activeGroup?.computed ?? []).map((transfer) => ({
        from: activeGroup?.members.find((member) => member.id === transfer.from)?.name || transfer.fromName || transfer.from,
        to: activeGroup?.members.find((member) => member.id === transfer.to)?.name || transfer.toName || transfer.to,
        amount: transfer.amount,
    }));

    return (
        <>
            <Stagger className={styles.page}>
                <StaggerItem>
                    <div className={styles.summary}>
                        <div className={cn(styles.summaryTile, youOwe > 0 && styles.summaryTileOwe)}>
                            <span className={styles.summaryHead}>
                                <span className={cn(styles.summaryIcon, styles.iconOwe)}><ArrowUpRight size={15} /></span>
                                You owe
                            </span>
                            <span className={styles.summaryValue}>{formatCurrency(youOwe)}</span>
                        </div>
                        <div className={cn(styles.summaryTile, owedToYou > 0 && styles.summaryTileOwed)}>
                            <span className={styles.summaryHead}>
                                <span className={cn(styles.summaryIcon, styles.iconOwed)}><ArrowDownLeft size={15} /></span>
                                Owed to you
                            </span>
                            <span className={styles.summaryValue}>{formatCurrency(owedToYou)}</span>
                        </div>
                        <p className={styles.netLine}>
                            {isGlobal ? 'Across all groups' : `In ${activeGroup?.groupEmoji ?? ''} ${activeGroup?.groupName ?? ''}`}
                            {' · net '}
                            <strong style={{ color: net > 0 ? 'var(--color-success)' : net < 0 ? 'var(--color-error)' : 'var(--fg-secondary)' }}>
                                {net > 0 ? '+' : net < 0 ? '−' : ''}{formatCurrency(Math.abs(net))}
                            </strong>
                        </p>
                    </div>
                </StaggerItem>

                {groups.length > 0 && (
                    <StaggerItem>
                        <ChipRow center>
                            {groups.map((group) => (
                                <Chip
                                    key={group.groupId}
                                    active={activeScope === group.groupId}
                                    onClick={() => { setScope(group.groupId); setFlowOpen(false); }}
                                    icon={<span>{group.groupEmoji}</span>}
                                >
                                    {group.groupName}
                                </Chip>
                            ))}
                            {groups.length > 1 && (
                                <Chip active={isGlobal} onClick={() => { setScope('all'); setFlowOpen(false); }} icon={<Globe size={14} />}>
                                    All groups
                                </Chip>
                            )}
                        </ChipRow>
                    </StaggerItem>
                )}

                {!isGlobal && activeGroup && graphSettlements.length > 0 && (
                    <StaggerItem>
                        <section className={styles.flowCard}>
                            <button type="button" className={styles.flowToggle} onClick={() => setFlowOpen((open) => !open)} aria-expanded={flowOpen}>
                                <IconTile><GitBranch size={18} /></IconTile>
                                <span className={styles.flowText}>
                                    <span className={styles.flowTitle}>Money flow map</span>
                                    <span className={styles.flowSubtitle}>
                                        {graphSettlements.length} simplified transfer{graphSettlements.length === 1 ? '' : 's'} settle every balance
                                    </span>
                                </span>
                                <ChevronDown size={18} className={cn(styles.flowChevron, flowOpen && styles.flowChevronOpen)} />
                            </button>
                            <AnimatePresence initial={false}>
                                {flowOpen && (
                                    <motion.div
                                        key="flow"
                                        initial={{ height: 0, opacity: 0 }}
                                        animate={{ height: 'auto', opacity: 1 }}
                                        exit={{ height: 0, opacity: 0 }}
                                        transition={{ type: 'spring', stiffness: 260, damping: 32 }}
                                        style={{ overflow: 'hidden' }}
                                    >
                                        <div className={styles.flowBody}>
                                            <Notice tone="info" icon={<Info size={15} />}>
                                                Debts are simplified so the group settles in the fewest payments. Drag the people around to explore.
                                            </Notice>
                                            <SettlementGraph
                                                members={graphMembers}
                                                settlements={graphSettlements}
                                                memberImages={graphImages}
                                                compact
                                                performanceMode={mode}
                                                instanceId={activeGroup.groupId}
                                            />
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </section>
                    </StaggerItem>
                )}

                <StaggerItem>
                    <Segmented<'pending' | 'settled'>
                        ariaLabel="Settlement status"
                        value={tab}
                        onChange={setTab}
                        options={[
                            { value: 'pending', label: 'Pending', count: pending.length },
                            { value: 'settled', label: 'Settled', count: settled.length },
                        ]}
                    />
                </StaggerItem>

                <StaggerItem>
                    {visible.length === 0 ? (
                        tab === 'pending' ? (
                            <EmptyState
                                compact
                                icon={<CheckCheck size={22} />}
                                title="All settled up"
                                description={isGlobal ? 'Nobody owes anybody across your groups.' : 'Everyone in this group is square. Enjoy it.'}
                            />
                        ) : (
                            <EmptyState
                                compact
                                icon={<Clock size={22} />}
                                title="No settled payments yet"
                                description="Payments you approve or record will show up here with their method and date."
                            />
                        )
                    ) : (
                        <div className={styles.list}>
                            <AnimatePresence initial={false}>
                                {visible.map((item) => (
                                    <motion.div
                                        key={item.id}
                                        layout
                                        initial={{ opacity: 0, y: 10 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, scale: 0.97 }}
                                        transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                                    >
                                        <TransferCard
                                            item={item}
                                            userId={userId}
                                            isGlobal={isGlobal}
                                            busy={busyId === item.id}
                                            onPay={() => payViaUpi(item)}
                                            onCash={() => setCashConfirm(item)}
                                            onApprove={() => respondToPayment(item, 'approve')}
                                            onReject={() => respondToPayment(item, 'reject')}
                                            onAcceptCash={() => acceptCash(item)}
                                            onDecline={() => declineRequest(item)}
                                            onRemind={() => remind(item)}
                                            onOpenGroup={() => setScope(item.groupId)}
                                        />
                                    </motion.div>
                                ))}
                            </AnimatePresence>
                        </div>
                    )}
                </StaggerItem>

                {!isGlobal && activeGroup && (
                    <StaggerItem>
                        <div className={styles.footerActions}>
                            <button type="button" className={styles.footerAction} onClick={() => exportAsText(exportPayload())}>
                                <span className={styles.footerIcon}><Download size={17} /></span>
                                Export
                            </button>
                            <button type="button" className={styles.footerAction} onClick={() => shareSettlement(exportPayload())}>
                                <span className={styles.footerIcon}><Share2 size={17} /></span>
                                Share
                            </button>
                            {isFeatureEnabled('balanceJourney') ? (
                                <button type="button" className={styles.footerAction} onClick={() => router.push(`/groups/${activeGroup.groupId}/journey`)}>
                                    <span className={styles.footerIcon}><GitBranch size={17} /></span>
                                    Why?
                                </button>
                            ) : (
                                <button type="button" className={styles.footerAction} onClick={() => router.push(`/groups/${activeGroup.groupId}`)}>
                                    <span className={styles.footerIcon}><Users size={17} /></span>
                                    Group
                                </button>
                            )}
                        </div>
                    </StaggerItem>
                )}
            </Stagger>

            <Modal isOpen={Boolean(cashConfirm)} onClose={() => setCashConfirm(null)} title="Paid in cash?" size="small">
                {cashConfirm && (
                    <div className={styles.confirm}>
                        <div className={styles.confirmPair}>
                            <Avatar name={cashConfirm.from.name} image={cashConfirm.from.image} size="lg" />
                            <ArrowRight size={20} style={{ color: 'var(--fg-muted)' }} />
                            <Avatar name={cashConfirm.to.name} image={cashConfirm.to.image} size="lg" />
                        </div>
                        <span className={styles.confirmAmount}>{formatCurrency(cashConfirm.amount)}</span>
                        <p className={styles.confirmText}>
                            We&apos;ll ask {firstName(cashConfirm.to.name)} to confirm they received the cash. The balance clears as soon as they approve.
                        </p>
                        <div className={styles.twoUp}>
                            <Button variant="secondary" onClick={() => setCashConfirm(null)}>Cancel</Button>
                            <Button
                                leftIcon={<Banknote size={17} />}
                                loading={busyId === cashConfirm.id}
                                onClick={() => markPaidInCash(cashConfirm)}
                            >
                                Yes, I paid
                            </Button>
                        </div>
                    </div>
                )}
            </Modal>

            <UpiPaymentModal
                isOpen={upi.open}
                onClose={() => setUpi({ open: false, amount: 0, payeeName: '' })}
                settlementId={upi.settlementId}
                amount={upi.amount}
                payeeName={upi.payeeName}
                payeeUpiId={upi.payeeUpiId}
                onPaymentComplete={() => {
                    setUpi({ open: false, amount: 0, payeeName: '' });
                    void refresh();
                }}
            />
        </>
    );
}

/* ═══════════════════════════════════════════════════════════════
   Transfer card
   ═══════════════════════════════════════════════════════════════ */

function TransferCard({
    item,
    userId,
    isGlobal,
    busy,
    onPay,
    onCash,
    onApprove,
    onReject,
    onAcceptCash,
    onDecline,
    onRemind,
    onOpenGroup,
}: {
    item: TransferItem;
    userId: string | null;
    isGlobal: boolean;
    busy: boolean;
    onPay: () => void;
    onCash: () => void;
    onApprove: () => void;
    onReject: () => void;
    onAcceptCash: () => void;
    onDecline: () => void;
    onRemind: () => void;
    onOpenGroup: () => void;
}) {
    const isSender = item.from.id === userId;
    const isReceiver = item.to.id === userId;
    const isSettled = isCompletedSettlementStatus(item.status);
    const isRecorded = item.source === 'recorded';
    const awaitingApproval = isAwaitingReceiverApproval(item.status);
    const isPendingRequest = isRecorded && isPendingSettlementStatus(item.status);
    const canSenderInitiate = isSender && (item.source === 'computed' || (isRecorded && canInitiateSettlementPayment(item.status)));
    const canReceiverApprove = isReceiver && awaitingApproval;

    const title = isSender
        ? `You pay ${firstName(item.to.name)}`
        : isReceiver
            ? `${firstName(item.from.name)} pays you`
            : `${firstName(item.from.name)} pays ${firstName(item.to.name)}`;

    const statusTag = isSettled
        ? <Tag tone="success" icon={<CheckCheck size={12} />}>Settled</Tag>
        : awaitingApproval
            ? <Tag tone="accent" icon={<Clock size={12} />}>{isReceiver ? 'Needs your approval' : 'Awaiting approval'}</Tag>
            : isPendingRequest
                ? <Tag tone="warning" icon={<ShieldAlert size={12} />}>{isSender ? 'Finish paying' : 'Payment started'}</Tag>
                : <Tag>Suggested</Tag>;

    const methodLabel = item.method ? (PAYMENT_METHODS[item.method]?.label || item.method.toUpperCase()) : null;

    let actions: React.ReactNode = null;
    if (!isSettled) {
        if (isGlobal) {
            actions = isSender || isReceiver ? (
                <div className={styles.transferActions}>
                    <Button size="md" variant="secondary" onClick={onOpenGroup} rightIcon={<ArrowRight size={16} />}>
                        Settle in {item.groupName}
                    </Button>
                </div>
            ) : (
                <div className={styles.transferNote}><Users size={15} /> Between other members of {item.groupName}</div>
            );
        } else if (canSenderInitiate) {
            actions = (
                <div className={styles.transferActions}>
                    <Button size="md" variant="secondary" leftIcon={<Banknote size={16} />} onClick={onCash} disabled={busy}>
                        Paid cash
                    </Button>
                    <Button size="md" leftIcon={<CreditCard size={16} />} onClick={onPay} loading={busy}>
                        {item.source === 'computed' ? 'Pay via UPI' : 'Continue'}
                    </Button>
                </div>
            );
        } else if (canReceiverApprove) {
            actions = (
                <div className={styles.transferActions}>
                    <Button size="md" variant="secondary" leftIcon={<X size={16} />} onClick={onReject} disabled={busy}>
                        Not received
                    </Button>
                    <Button size="md" variant="success" leftIcon={<CheckCheck size={16} />} onClick={onApprove} loading={busy}>
                        Approve
                    </Button>
                </div>
            );
        } else if (isReceiver) {
            actions = (
                <div className={styles.transferActions}>
                    {isRecorded ? (
                        <Button size="md" variant="secondary" leftIcon={<X size={16} />} onClick={onDecline} disabled={busy}>
                            Not paid
                        </Button>
                    ) : (
                        <Button size="md" variant="secondary" leftIcon={<Bell size={16} />} onClick={onRemind} disabled={busy}>
                            Remind
                        </Button>
                    )}
                    <Button size="md" variant="success" leftIcon={<Banknote size={16} />} onClick={onAcceptCash} loading={busy}>
                        Got cash
                    </Button>
                </div>
            );
        } else if (isSender && awaitingApproval) {
            actions = <div className={styles.transferNote}><Clock size={15} /> Waiting for {firstName(item.to.name)} to confirm receipt</div>;
        } else {
            actions = <div className={styles.transferNote}><Users size={15} /> Between {firstName(item.from.name)} and {firstName(item.to.name)}</div>;
        }
    }

    return (
        <article className={cn(styles.transfer, isSettled && styles.transferSettled)}>
            <div className={styles.transferTop}>
                <span className={styles.pair}>
                    <Avatar name={item.from.name} image={item.from.image} size="md" />
                    <Avatar name={item.to.name} image={item.to.image} size="md" />
                    <span className={styles.pairArrow}><ArrowRight size={11} strokeWidth={2.6} /></span>
                </span>
                <div className={styles.transferText}>
                    <span className={styles.transferTitle}>{title}</span>
                    <span className={styles.transferSub}>
                        {statusTag}
                        <span>{item.groupEmoji} {item.groupName}</span>
                        {isSettled && methodLabel && <span>· {methodLabel}</span>}
                        {isSettled && item.createdAt && <span>· {formatDate(item.createdAt)}</span>}
                    </span>
                </div>
                <span
                    className={cn(
                        styles.transferAmount,
                        isSender ? styles.amountOut : isReceiver ? styles.amountIn : styles.amountNeutral,
                    )}
                >
                    {formatCurrency(item.amount)}
                </span>
            </div>
            {actions}
        </article>
    );
}
