'use client';

import { useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import useSWR from 'swr';
import { AnimatePresence, motion } from 'framer-motion';
import { QRCodeSVG } from 'qrcode.react';
import {
    ArrowRightLeft,
    CalendarDays,
    Check,
    Copy,
    GitBranch,
    Image as ImageIcon,
    Link2,
    Mail,
    MessageCircle,
    MessageSquare,
    Plus,
    ReceiptText,
    Send,
    Share2,
    Trash2,
    UserMinus,
    UserPlus,
    Users,
} from 'lucide-react';
import Avatar, { AvatarGroup } from '@/components/ui/Avatar';
import Button from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import { Input } from '@/components/ui/Input';
import Modal from '@/components/ui/Modal';
import Skeleton, { ListSkeleton } from '@/components/ui/Skeleton';
import { CategoryTile } from '@/components/ui/Icons';
import {
    Amount,
    IconButton,
    IconTile,
    ListGroup,
    ListRow,
    Section,
    Segmented,
    Spinner,
    Stagger,
    StaggerItem,
    Tag,
} from '@/components/ui/kit';
import { useToast } from '@/components/ui/Toast';
import GroupChat from '@/components/features/GroupChat';
import UpiPaymentModal from '@/components/features/UpiPaymentModal';
import { useHaptics } from '@/hooks/useHaptics';
import { useIsClient } from '@/hooks/useMediaQuery';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { getNetworkErrorCopy, NetworkTaggedError, toNetworkTaggedError } from '@/lib/networkErrors';
import { refreshMoneyData } from '@/lib/swr';
import { cn, formatCurrency, formatDate, timeAgo } from '@/lib/utils';
import styles from './groupDetail.module.css';

interface ContactForInvite {
    id: string;
    name: string;
    email: string;
    linkedUser: { id: string; name: string | null; image: string | null } | null;
}

interface MemberData {
    userId: string;
    role: string;
    nickname: string | null;
    user: { id: string; name: string | null; email: string | null; image: string | null };
}

interface TransactionData {
    id: string;
    title: string;
    amount: number;
    category: string;
    createdAt: string;
    payer: { id: string; name: string | null };
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

interface SuggestedTransfer {
    from: string;
    fromName: string;
    to: string;
    toName: string;
    amount: number;
}

interface BalancesPayload {
    balances?: Record<string, number>;
    settlements?: SuggestedTransfer[];
}

interface JourneyMeta {
    currentBalance?: number;
    changeCountThisWeek?: number;
    currentRouteSummary?: string;
}

type Tab = 'overview' | 'activity' | 'members' | 'chat';

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const firstName = (name?: string | null) => (name || 'Member').split(' ')[0];

/** Resolves to null for 403/404 so the page can show a friendly "not found". */
async function groupFetcher<T>(url: string): Promise<T | null> {
    let response: Response;
    try {
        response = await fetch(url);
    } catch (error) {
        throw toNetworkTaggedError({ error });
    }
    if (response.status === 401) {
        window.location.href = '/login';
        return null;
    }
    if (response.status === 403 || response.status === 404) return null;
    if (!response.ok) throw toNetworkTaggedError({ response });
    return response.json() as Promise<T>;
}

export default function GroupDetailPage() {
    const params = useParams();
    const router = useRouter();
    const groupId = params.groupId as string;
    const { toast } = useToast();
    const haptics = useHaptics();
    const isClient = useIsClient();

    const [tab, setTab] = useState<Tab>('overview');
    const [sheet, setSheet] = useState<'invite' | 'contacts' | 'trip' | 'delete' | null>(null);
    const [memberToRemove, setMemberToRemove] = useState<MemberData | null>(null);
    const [busy, setBusy] = useState(false);
    const [copied, setCopied] = useState(false);
    const [tripTitle, setTripTitle] = useState('');
    const [tripStart, setTripStart] = useState('');
    const [tripEnd, setTripEnd] = useState('');
    const [contacts, setContacts] = useState<ContactForInvite[] | null>(null);
    const [sendingInviteTo, setSendingInviteTo] = useState<string | null>(null);
    const [upiModal, setUpiModal] = useState<{ open: boolean; settlementId: string; amount: number; payeeName: string }>({
        open: false,
        settlementId: '',
        amount: 0,
        payeeName: '',
    });

    const groupQuery = useSWR<GroupDetailData | null>(
        groupId ? `/api/groups/${groupId}` : null,
        (url: string) => groupFetcher<GroupDetailData>(url),
        { revalidateOnFocus: true, keepPreviousData: true }
    );
    const balancesQuery = useSWR<BalancesPayload | null>(
        groupId ? `/api/groups/${groupId}/balances` : null,
        (url: string) => groupFetcher<BalancesPayload>(url),
        { revalidateOnFocus: true }
    );
    const journeyQuery = useSWR<JourneyMeta | null>(
        groupId && isFeatureEnabled('balanceJourney') ? `/api/groups/${groupId}/balance-history?limit=1` : null,
        (url: string) => groupFetcher<JourneyMeta>(url)
    );

    const group = groupQuery.data;
    const balances = useMemo(
        () => balancesQuery.data?.balances ?? group?.balances ?? {},
        [balancesQuery.data, group]
    );
    const suggested = balancesQuery.data?.settlements ?? [];

    const orderedMembers = useMemo(() => {
        if (!group) return [];
        return [...group.members].sort((a, b) => {
            if (a.userId === group.currentUserId) return -1;
            if (b.userId === group.currentUserId) return 1;
            return (a.user.name || '').localeCompare(b.user.name || '');
        });
    }, [group]);

    const allTransactions = useMemo(
        () => (group?.trips ?? [])
            .flatMap((trip) => trip.transactions)
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
        [group]
    );

    const refreshGroup = async () => {
        await Promise.all([groupQuery.mutate(), balancesQuery.mutate(), journeyQuery.mutate(), refreshMoneyData()]);
    };

    if (groupQuery.isLoading && group === undefined) {
        return (
            <div className={styles.page}>
                <Skeleton variant="rectangular" height={330} radius={28} />
                <Skeleton variant="rectangular" height={46} radius="var(--radius-full)" />
                <ListSkeleton rows={3} />
            </div>
        );
    }

    if (groupQuery.error instanceof NetworkTaggedError && !group) {
        const copy = getNetworkErrorCopy(groupQuery.error.variant);
        return <ErrorState variant={groupQuery.error.variant} title={copy.title} message={copy.message} onRetry={() => groupQuery.mutate()} />;
    }

    if (!group) {
        return (
            <div className={styles.page}>
                <EmptyState
                    icon={<Users size={26} />}
                    title="Group not found"
                    description="It may have been deleted, or you’re no longer a member."
                    actionLabel="Back to groups"
                    actionHref="/groups"
                    actionIcon={<ArrowRightLeft size={16} />}
                />
            </div>
        );
    }

    const me = group.currentUserId;
    const isOwner = me === group.ownerId;
    const isAdmin = isOwner || group.members.some((member) => member.userId === me && member.role === 'admin');
    const myBalance = balances[me] ?? 0;
    const perPerson = group.members.length ? Math.round(group.totalSpent / group.members.length) : 0;
    const inviteLink = isClient ? `${window.location.origin}/join/${group.inviteCode}` : '';
    const journey = journeyQuery.data;
    const activeTrip = group.activeTrip;

    const copyInvite = async () => {
        try {
            await navigator.clipboard.writeText(inviteLink);
            setCopied(true);
            haptics.light();
            setTimeout(() => setCopied(false), 2000);
        } catch {
            toast('Could not copy the link', 'error');
        }
    };

    const shareInvite = async () => {
        if (navigator.share) {
            try {
                await navigator.share({ title: `Join ${group.name} on SplitX`, text: `Split expenses with us in "${group.name}".`, url: inviteLink });
            } catch { /* dismissed */ }
        } else {
            copyInvite();
        }
    };

    const openContacts = async () => {
        setSheet('contacts');
        if (contacts) return;
        try {
            const res = await fetch('/api/contacts');
            const data: ContactForInvite[] = res.ok ? await res.json() : [];
            setContacts(data.filter((contact) => contact.linkedUser));
        } catch {
            setContacts([]);
            toast('Could not load your contacts', 'error');
        }
    };

    const inviteContact = async (contact: ContactForInvite) => {
        if (!contact.linkedUser) return;
        setSendingInviteTo(contact.linkedUser.id);
        try {
            const res = await fetch('/api/invitations', {
                method: 'POST',
                headers: JSON_HEADERS,
                body: JSON.stringify({ groupId: group.id, inviteeId: contact.linkedUser.id }),
            });
            const data = await res.json().catch(() => ({}));
            toast(res.ok ? `Invite sent to ${firstName(contact.name)}` : data.error || 'Could not send the invite', res.ok ? 'success' : 'error');
        } catch {
            toast('Network error', 'error');
        } finally {
            setSendingInviteTo(null);
        }
    };

    const createTrip = async () => {
        if (!tripTitle.trim()) return;
        setBusy(true);
        try {
            const res = await fetch('/api/trips', {
                method: 'POST',
                headers: JSON_HEADERS,
                body: JSON.stringify({
                    groupId,
                    title: tripTitle.trim(),
                    startDate: tripStart || undefined,
                    endDate: tripEnd || undefined,
                }),
            });
            if (res.ok) {
                toast('Trip created', 'success');
                setSheet(null);
                setTripTitle('');
                setTripStart('');
                setTripEnd('');
                await refreshGroup();
            } else {
                toast('Could not create the trip', 'error');
            }
        } catch {
            toast('Network error', 'error');
        } finally {
            setBusy(false);
        }
    };

    const removeMember = async () => {
        if (!memberToRemove) return;
        setBusy(true);
        try {
            const res = await fetch(`/api/groups/${groupId}/members`, {
                method: 'DELETE',
                headers: JSON_HEADERS,
                body: JSON.stringify({ userId: memberToRemove.userId }),
            });
            if (res.ok) {
                toast(`${firstName(memberToRemove.user.name)} was removed from the group`, 'success');
                setMemberToRemove(null);
                await refreshGroup();
            } else {
                const data = await res.json().catch(() => ({}));
                toast(data.error || 'Could not remove this member', 'error');
            }
        } catch {
            toast('Network error', 'error');
        } finally {
            setBusy(false);
        }
    };

    const deleteGroup = async () => {
        setBusy(true);
        try {
            const res = await fetch(`/api/groups/${groupId}`, { method: 'DELETE' });
            if (res.ok) {
                toast(`${group.name} was deleted`, 'success');
                void refreshMoneyData();
                router.push('/groups');
            } else {
                const data = await res.json().catch(() => ({}));
                toast(data.error || 'Could not delete the group', 'error');
            }
        } catch {
            toast('Network error', 'error');
        } finally {
            setBusy(false);
            setSheet(null);
        }
    };

    return (
        <>
            <Stagger className={styles.page}>
                {/* ── Hero ── */}
                <StaggerItem>
                    <section className={styles.hero}>
                        <div className={styles.heroActions}>
                            <IconButton icon={<Share2 size={16} />} label="Invite people" size="sm" onClick={() => setSheet('invite')} />
                            {isOwner && (
                                <IconButton icon={<Trash2 size={15} />} label="Delete group" size="sm" onClick={() => setSheet('delete')} />
                            )}
                        </div>
                        <motion.span
                            className={styles.emoji}
                            initial={{ scale: 0.6, rotate: -10 }}
                            animate={{ scale: 1, rotate: 0 }}
                            transition={{ type: 'spring', stiffness: 380, damping: 18 }}
                        >
                            {group.emoji}
                        </motion.span>
                        <h1 className={styles.name}>{group.name}</h1>
                        <p className={styles.meta}>
                            {group.members.length} member{group.members.length === 1 ? '' : 's'} · since {formatDate(group.createdAt)}
                        </p>
                        <button type="button" className={styles.avatarsButton} onClick={() => setTab('members')} aria-label="View members">
                            <AvatarGroup
                                users={group.members.map((member) => ({ name: member.user.name || 'Member', image: member.user.image }))}
                                max={6}
                                size="sm"
                            />
                        </button>

                        <div className={styles.stats}>
                            <div className={styles.stat}>
                                <span className={styles.statLabel}>Total spent</span>
                                <span className={styles.statValue}>{formatCurrency(group.totalSpent)}</span>
                            </div>
                            <div className={styles.stat}>
                                <span className={styles.statLabel}>Per person</span>
                                <span className={styles.statValue}>{formatCurrency(perPerson)}</span>
                            </div>
                            <div className={cn(styles.stat, myBalance > 0 && styles.statPositive, myBalance < 0 && styles.statNegative)}>
                                <span className={styles.statLabel}>
                                    {myBalance > 0 ? 'You get back' : myBalance < 0 ? 'You owe' : 'Your balance'}
                                </span>
                                <span className={styles.statValue}>{myBalance === 0 ? 'Settled' : formatCurrency(Math.abs(myBalance))}</span>
                            </div>
                        </div>

                        <div className={styles.heroButtons}>
                            <Button leftIcon={<Plus size={17} />} onClick={() => router.push(`/transactions/new?groupId=${group.id}`)}>
                                Add expense
                            </Button>
                            <Button variant="secondary" leftIcon={<ArrowRightLeft size={17} />} onClick={() => router.push('/settlements')}>
                                Settle up
                            </Button>
                        </div>
                    </section>
                </StaggerItem>

                <StaggerItem>
                    <Segmented<Tab>
                        ariaLabel="Group sections"
                        value={tab}
                        onChange={setTab}
                        options={[
                            { value: 'overview', label: 'Overview' },
                            { value: 'activity', label: 'Activity' },
                            { value: 'members', label: 'Members' },
                            { value: 'chat', label: 'Chat' },
                        ]}
                    />
                </StaggerItem>

                <StaggerItem>
                    <AnimatePresence mode="wait" initial={false}>
                        <motion.div
                            key={tab}
                            className={styles.tabContent}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -6 }}
                            transition={{ duration: 0.18 }}
                        >
                            {tab === 'overview' && (
                                <>
                                    {journey && isFeatureEnabled('balanceJourney') && (
                                        <ListGroup>
                                            <ListRow
                                                href={`/groups/${group.id}/journey`}
                                                leading={<IconTile><GitBranch size={18} /></IconTile>}
                                                title="Your balance journey"
                                                subtitle={journey.currentRouteSummary || 'See how your balance changed'}
                                                trailing={<Amount value={journey.currentBalance ?? 0} tone="auto" signed />}
                                                trailingSub={`${journey.changeCountThisWeek ?? 0} this week`}
                                            />
                                        </ListGroup>
                                    )}

                                    <Section title="Balances" subtitle="Positive means they get money back">
                                        <ListGroup>
                                            {orderedMembers.map((member) => {
                                                const balance = balances[member.userId] ?? 0;
                                                return (
                                                    <ListRow
                                                        key={member.userId}
                                                        leading={<Avatar name={member.user.name || 'Member'} image={member.user.image} size="md" />}
                                                        title={member.userId === me ? `${member.user.name || 'You'} (you)` : member.user.name || 'Member'}
                                                        subtitle={balance > 0 ? 'Gets back' : balance < 0 ? 'Owes the group' : 'Settled up'}
                                                        trailing={<Amount value={balance} tone="auto" signed />}
                                                    />
                                                );
                                            })}
                                        </ListGroup>
                                    </Section>

                                    {suggested.length > 0 && (
                                        <Section title="Suggested payments" action={{ label: 'Settle up', href: '/settlements' }}>
                                            <ListGroup>
                                                {suggested.map((transfer) => {
                                                    const from = group.members.find((member) => member.userId === transfer.from);
                                                    const to = group.members.find((member) => member.userId === transfer.to);
                                                    return (
                                                        <ListRow
                                                            key={`${transfer.from}-${transfer.to}`}
                                                            href="/settlements"
                                                            leading={(
                                                                <span className={styles.pair}>
                                                                    <Avatar name={transfer.fromName} image={from?.user.image} size="sm" />
                                                                    <Avatar name={transfer.toName} image={to?.user.image} size="sm" />
                                                                </span>
                                                            )}
                                                            title={`${transfer.from === me ? 'You' : firstName(transfer.fromName)} → ${transfer.to === me ? 'you' : firstName(transfer.toName)}`}
                                                            subtitle="Simplified transfer"
                                                            trailing={<Amount value={transfer.amount} tone={transfer.from === me ? 'danger' : transfer.to === me ? 'success' : 'neutral'} />}
                                                        />
                                                    );
                                                })}
                                            </ListGroup>
                                        </Section>
                                    )}

                                    <Section title="Trip">
                                        {activeTrip ? (
                                            <ListGroup>
                                                <ListRow
                                                    leading={<IconTile tone="neutral"><CalendarDays size={18} /></IconTile>}
                                                    title={activeTrip.title}
                                                    subtitle={`${formatDate(activeTrip.startDate || activeTrip.createdAt)} → ${activeTrip.endDate ? formatDate(activeTrip.endDate) : 'Present'}`}
                                                    trailing={<Tag tone={activeTrip.isActive ? 'success' : 'neutral'}>{activeTrip.isActive ? 'Active' : 'Closed'}</Tag>}
                                                />
                                            </ListGroup>
                                        ) : (
                                            <EmptyState
                                                compact
                                                icon={<CalendarDays size={22} />}
                                                title="No trip yet"
                                                description="Trips keep the expenses for a specific plan together."
                                                actionLabel="Create trip"
                                                onAction={() => setSheet('trip')}
                                            />
                                        )}
                                    </Section>

                                    <Section title="More">
                                        <ListGroup>
                                            <ListRow
                                                href={`/groups/${group.id}/receipts`}
                                                leading={<IconTile tone="neutral"><ImageIcon size={18} /></IconTile>}
                                                title="Receipts"
                                                subtitle="Every scanned bill for this group"
                                                chevron
                                            />
                                            <ListRow
                                                onClick={() => setSheet('invite')}
                                                leading={<IconTile tone="neutral"><UserPlus size={18} /></IconTile>}
                                                title="Invite people"
                                                subtitle="Share a link or QR code"
                                                chevron
                                            />
                                        </ListGroup>
                                    </Section>
                                </>
                            )}

                            {tab === 'activity' && (
                                allTransactions.length > 0 ? (
                                    <ListGroup>
                                        {allTransactions.map((transaction) => (
                                            <ListRow
                                                key={transaction.id}
                                                href={`/transactions?focus=${transaction.id}`}
                                                leading={<CategoryTile category={transaction.category} />}
                                                title={transaction.title}
                                                subtitle={`${transaction.payer.id === me ? 'You' : firstName(transaction.payer.name)} paid · ${timeAgo(transaction.createdAt)}`}
                                                trailing={<Amount value={transaction.amount} />}
                                            />
                                        ))}
                                    </ListGroup>
                                ) : (
                                    <EmptyState
                                        compact
                                        icon={<ReceiptText size={22} />}
                                        title="No expenses yet"
                                        description="Add the first expense for this group."
                                        actionLabel="Add expense"
                                        actionHref={`/transactions/new?groupId=${group.id}`}
                                    />
                                )
                            )}

                            {tab === 'members' && (
                                <>
                                    <ListGroup>
                                        {orderedMembers.map((member) => {
                                            const balance = balances[member.userId] ?? 0;
                                            const canRemove = isAdmin && member.userId !== me && member.userId !== group.ownerId;
                                            return (
                                                <ListRow
                                                    key={member.userId}
                                                    leading={<Avatar name={member.user.name || 'Member'} image={member.user.image} size="md" />}
                                                    title={member.userId === me ? `${member.user.name || 'You'} (you)` : member.user.name || 'Member'}
                                                    meta={(
                                                        <>
                                                            {member.userId === group.ownerId && <Tag tone="accent">Owner</Tag>}
                                                            {member.role === 'admin' && member.userId !== group.ownerId && <Tag tone="accent">Admin</Tag>}
                                                            {member.user.email && <Tag>{member.user.email}</Tag>}
                                                        </>
                                                    )}
                                                    trailing={(
                                                        <span className={styles.memberTrailing}>
                                                            <span className={styles.memberAmount}>
                                                                <Amount value={balance} tone="auto" signed />
                                                                <span className={styles.memberAmountSub}>{balance > 0 ? 'gets back' : balance < 0 ? 'owes' : 'settled'}</span>
                                                            </span>
                                                            {canRemove && (
                                                                <IconButton
                                                                    icon={<UserMinus size={15} />}
                                                                    label={`Remove ${member.user.name || 'member'}`}
                                                                    variant="ghost"
                                                                    size="sm"
                                                                    onClick={() => setMemberToRemove(member)}
                                                                />
                                                            )}
                                                        </span>
                                                    )}
                                                />
                                            );
                                        })}
                                    </ListGroup>
                                    <div className={styles.twoUp}>
                                        <Button variant="secondary" leftIcon={<Link2 size={16} />} onClick={() => setSheet('invite')}>
                                            Invite link
                                        </Button>
                                        <Button leftIcon={<UserPlus size={16} />} onClick={openContacts}>
                                            From contacts
                                        </Button>
                                    </div>
                                </>
                            )}

                            {tab === 'chat' && (
                                <GroupChat
                                    groupId={groupId}
                                    currentUserId={group.currentUserId}
                                    members={group.members}
                                    balances={balances}
                                    onPayRequest={(settlementId, amount, payeeName) =>
                                        setUpiModal({ open: true, settlementId, amount, payeeName })
                                    }
                                />
                            )}
                        </motion.div>
                    </AnimatePresence>
                </StaggerItem>
            </Stagger>

            <UpiPaymentModal
                isOpen={upiModal.open}
                onClose={() => setUpiModal({ open: false, settlementId: '', amount: 0, payeeName: '' })}
                settlementId={upiModal.settlementId}
                amount={upiModal.amount}
                payeeName={upiModal.payeeName}
                onPaymentComplete={() => {
                    setUpiModal({ open: false, settlementId: '', amount: 0, payeeName: '' });
                    void refreshGroup();
                }}
            />

            {/* ── Invite ── */}
            <Modal isOpen={sheet === 'invite'} onClose={() => setSheet(null)} title={`Invite to ${group.name}`} size="small">
                <div className={styles.sheet}>
                    {inviteLink && (
                        <div className={styles.qr}>
                            <QRCodeSVG value={inviteLink} size={156} level="M" bgColor="#ffffff" fgColor="#0d0f14" />
                        </div>
                    )}
                    <div className={styles.linkBox}>
                        <Link2 size={16} style={{ color: 'var(--fg-muted)', flexShrink: 0 }} />
                        <span className={styles.linkText}>{inviteLink}</span>
                        <Button size="sm" variant={copied ? 'soft' : 'secondary'} onClick={copyInvite} leftIcon={copied ? <Check size={14} /> : <Copy size={14} />}>
                            {copied ? 'Copied' : 'Copy'}
                        </Button>
                    </div>
                    <div className={styles.shareGrid}>
                        <button
                            type="button"
                            className={styles.shareOption}
                            onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent(`Join "${group.name}" on SplitX to split expenses: ${inviteLink}`)}`, '_blank')}
                        >
                            <span className={styles.shareIcon}><MessageCircle size={18} /></span>
                            WhatsApp
                        </button>
                        <button
                            type="button"
                            className={styles.shareOption}
                            onClick={() => window.open(`sms:?body=${encodeURIComponent(`Join "${group.name}" on SplitX: ${inviteLink}`)}`, '_blank')}
                        >
                            <span className={styles.shareIcon}><MessageSquare size={18} /></span>
                            SMS
                        </button>
                        <button
                            type="button"
                            className={styles.shareOption}
                            onClick={() => window.open(`mailto:?subject=${encodeURIComponent(`Join ${group.name} on SplitX`)}&body=${encodeURIComponent(`Split expenses with us in "${group.name}".\n\n${inviteLink}`)}`, '_blank')}
                        >
                            <span className={styles.shareIcon}><Mail size={18} /></span>
                            Email
                        </button>
                    </div>
                    <Button fullWidth leftIcon={<Share2 size={16} />} onClick={shareInvite}>More ways to share</Button>
                </div>
            </Modal>

            {/* ── Invite from contacts ── */}
            <Modal isOpen={sheet === 'contacts'} onClose={() => setSheet(null)} title="Invite from contacts" size="small">
                {contacts === null ? (
                    <ListSkeleton rows={3} />
                ) : contacts.length === 0 ? (
                    <EmptyState
                        compact
                        variant="plain"
                        icon={<Users size={22} />}
                        title="No contacts on SplitX yet"
                        description="Add friends in Contacts, or share the invite link instead."
                        actionLabel="Share invite link"
                        actionIcon={<Link2 size={16} />}
                        onAction={() => setSheet('invite')}
                    />
                ) : (
                    <ListGroup>
                        {contacts.map((contact) => {
                            const alreadyIn = group.members.some((member) => member.userId === contact.linkedUser?.id);
                            const sending = sendingInviteTo === contact.linkedUser?.id;
                            return (
                                <ListRow
                                    key={contact.id}
                                    onClick={alreadyIn || sending ? undefined : () => inviteContact(contact)}
                                    leading={<Avatar name={contact.name} image={contact.linkedUser?.image} size="md" />}
                                    title={contact.name}
                                    subtitle={contact.email}
                                    trailing={alreadyIn
                                        ? <Tag tone="success">In group</Tag>
                                        : sending ? <Spinner size={16} /> : <Tag tone="accent" icon={<Send size={11} />}>Invite</Tag>}
                                />
                            );
                        })}
                    </ListGroup>
                )}
            </Modal>

            {/* ── Create trip ── */}
            <Modal isOpen={sheet === 'trip'} onClose={() => setSheet(null)} title="New trip" size="small">
                <div className={styles.sheet}>
                    <Input label="Trip name" value={tripTitle} onChange={(event) => setTripTitle(event.target.value)} placeholder="e.g. Goa weekend" autoFocus />
                    <div className={styles.dateRow}>
                        <Input label="Starts" type="date" value={tripStart} onChange={(event) => setTripStart(event.target.value)} />
                        <Input label="Ends" type="date" value={tripEnd} onChange={(event) => setTripEnd(event.target.value)} />
                    </div>
                    <Button fullWidth size="lg" disabled={!tripTitle.trim()} loading={busy} leftIcon={<Plus size={17} />} onClick={createTrip}>
                        Create trip
                    </Button>
                </div>
            </Modal>

            {/* ── Remove member ── */}
            <Modal isOpen={Boolean(memberToRemove)} onClose={() => setMemberToRemove(null)} title="Remove member" size="small">
                {memberToRemove && (
                    <div className={styles.confirm}>
                        <Avatar name={memberToRemove.user.name || 'Member'} image={memberToRemove.user.image} size="xl" />
                        <p className={styles.confirmTitle}>Remove {firstName(memberToRemove.user.name)}?</p>
                        <p className={styles.confirmText}>
                            They&apos;ll lose access to this group&apos;s expenses and chat, and their past expenses stay in the history. Only someone who is settled up can be removed. You can invite them again anytime.
                        </p>
                        <div className={styles.twoUp} style={{ width: '100%', marginTop: 6 }}>
                            <Button variant="secondary" onClick={() => setMemberToRemove(null)} disabled={busy}>Cancel</Button>
                            <Button variant="danger" leftIcon={<UserMinus size={16} />} loading={busy} onClick={removeMember}>Remove</Button>
                        </div>
                    </div>
                )}
            </Modal>

            {/* ── Delete group ── */}
            <Modal isOpen={sheet === 'delete'} onClose={() => setSheet(null)} title="Delete group" size="small">
                <div className={styles.confirm}>
                    <span className={styles.confirmIcon}><Trash2 size={26} /></span>
                    <p className={styles.confirmTitle}>Delete {group.name}?</p>
                    <p className={styles.confirmText}>
                        This removes the group and all of its expenses for everyone. A group can only be deleted once everyone is settled up. This can&apos;t be undone.
                    </p>
                    <div className={styles.twoUp} style={{ width: '100%', marginTop: 6 }}>
                        <Button variant="secondary" onClick={() => setSheet(null)} disabled={busy}>Keep group</Button>
                        <Button variant="danger" leftIcon={<Trash2 size={16} />} loading={busy} onClick={deleteGroup}>Delete</Button>
                    </div>
                </div>
            </Modal>
        </>
    );
}
