'use client';

import { Suspense, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import useSWR from 'swr';
import { AnimatePresence, motion } from 'framer-motion';
import { QRCodeSVG } from 'qrcode.react';
import {
    ArrowDownLeft,
    ArrowUpRight,
    Check,
    CheckCheck,
    ChevronRight,
    Contact,
    Copy,
    Link2,
    LogIn,
    Plus,
    Share2,
    Users,
} from 'lucide-react';
import Button from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import Modal from '@/components/ui/Modal';
import { AvatarGroup } from '@/components/ui/Avatar';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import { GroupCardSkeleton } from '@/components/ui/Skeleton';
import { PageIntro, Stagger, StaggerItem } from '@/components/ui/kit';
import { useToast } from '@/components/ui/Toast';
import { useBalances } from '@/hooks/useBalances';
import { useHaptics } from '@/hooks/useHaptics';
import { fetcher, refreshMoneyData } from '@/lib/swr';
import { getNetworkErrorCopy, NetworkTaggedError } from '@/lib/networkErrors';
import { cn, formatCurrency, timeAgo } from '@/lib/utils';
import styles from './groups.module.css';

const GROUP_EMOJIS = ['✈️', '🏖️', '🏔️', '🏠', '🍕', '🎉', '🚗', '🎮', '💼', '🎓', '🏋️', '🎵', '☕', '🛒', '⚽', '🎬'];

interface GroupData {
    id: string;
    name: string;
    emoji: string;
    inviteCode: string;
    members: { user: { id: string; name: string | null; image: string | null } }[];
    _count?: { trips: number };
    updatedAt: string;
    totalSpent?: number;
}

export default function GroupsPage() {
    return (
        <Suspense fallback={<GroupCardSkeleton />}>
            <GroupsContent />
        </Suspense>
    );
}

function GroupsContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { toast } = useToast();
    const haptics = useHaptics();
    const balances = useBalances();

    const [sheet, setSheet] = useState<'create' | 'join' | null>(() =>
        searchParams.get('create') ? 'create' : searchParams.get('join') ? 'join' : null
    );
    const [groupName, setGroupName] = useState('');
    const [selectedEmoji, setSelectedEmoji] = useState('✈️');
    const [creating, setCreating] = useState(false);
    const [createdGroup, setCreatedGroup] = useState<{ id: string; inviteLink: string } | null>(null);
    const [copied, setCopied] = useState(false);
    const [joinInput, setJoinInput] = useState('');
    const [joining, setJoining] = useState(false);

    const { data, error, isLoading, mutate } = useSWR<GroupData[]>('/api/groups', fetcher, {
        keepPreviousData: true,
        revalidateOnFocus: true,
        dedupingInterval: 5000,
    });
    const groups = useMemo(() => (Array.isArray(data) ? data : []), [data]);
    const totalTracked = groups.reduce((sum, group) => sum + (group.totalSpent || 0), 0);

    const closeSheet = () => {
        setSheet(null);
        setGroupName('');
        setSelectedEmoji('✈️');
        setCreatedGroup(null);
        setJoinInput('');
        setCopied(false);
        if (searchParams.get('create') || searchParams.get('join')) router.replace('/groups');
    };

    const handleCreate = async () => {
        if (!groupName.trim() || creating) return;
        setCreating(true);
        try {
            const res = await fetch('/api/groups', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: groupName.trim(), emoji: selectedEmoji }),
            });
            if (!res.ok) {
                toast('Could not create the group — please try again', 'error');
                return;
            }
            const group = await res.json();
            haptics.success();
            setCreatedGroup({ id: group.id, inviteLink: `${window.location.origin}/join/${group.inviteCode}` });
            await Promise.all([mutate(), refreshMoneyData()]);
        } catch {
            toast('Network error — please check your connection', 'error');
        } finally {
            setCreating(false);
        }
    };

    const handleCopy = async () => {
        if (!createdGroup) return;
        try {
            await navigator.clipboard.writeText(createdGroup.inviteLink);
            setCopied(true);
            haptics.light();
            setTimeout(() => setCopied(false), 2000);
        } catch {
            toast('Could not copy the link', 'error');
        }
    };

    const handleShare = async () => {
        if (!createdGroup) return;
        if (navigator.share) {
            try {
                await navigator.share({
                    title: 'Join my group on SplitX',
                    text: `Join "${groupName.trim()}" on SplitX to split expenses together.`,
                    url: createdGroup.inviteLink,
                });
            } catch {
                // share sheet dismissed
            }
        } else {
            handleCopy();
        }
    };

    const handleJoin = async () => {
        if (!joinInput.trim() || joining) return;
        setJoining(true);
        try {
            let code = joinInput.trim();
            const urlMatch = code.match(/\/join\/([^/?#]+)/);
            if (urlMatch) code = urlMatch[1];

            const res = await fetch('/api/groups/join', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ inviteCode: code }),
            });
            const result = await res.json();
            if (res.ok) {
                haptics.success();
                toast(result.message === 'Already a member' ? 'You’re already in this group' : 'You joined the group 🎉', 'success');
                closeSheet();
                await Promise.all([mutate(), refreshMoneyData()]);
                if (result.groupId) router.push(`/groups/${result.groupId}`);
            } else {
                toast(result.error || 'That invite link or code is not valid', 'error');
            }
        } catch {
            toast('Network error — please try again', 'error');
        } finally {
            setJoining(false);
        }
    };

    if (isLoading && !data) return <GroupCardSkeleton />;

    if (error instanceof NetworkTaggedError && !data) {
        const copy = getNetworkErrorCopy(error.variant);
        return <ErrorState variant={error.variant} title={copy.title} message={copy.message} onRetry={() => mutate()} />;
    }

    return (
        <>
            <Stagger className={styles.page}>
                <StaggerItem>
                    <PageIntro
                        eyebrow="Shared spaces"
                        title={groups.length ? 'Your groups' : 'Life is better shared'}
                        subtitle={groups.length
                            ? `${groups.length} group${groups.length === 1 ? '' : 's'} · ${formatCurrency(totalTracked)} tracked together`
                            : 'Split trips, flats and everyday plans with the people you share them with.'}
                    />
                </StaggerItem>

                <StaggerItem className={styles.actions}>
                    <Button size="lg" fullWidth leftIcon={<Plus size={18} />} onClick={() => setSheet('create')}>
                        New group
                    </Button>
                    <Button size="lg" fullWidth variant="secondary" leftIcon={<LogIn size={18} />} onClick={() => setSheet('join')}>
                        Join
                    </Button>
                </StaggerItem>

                {groups.length === 0 ? (
                    <StaggerItem>
                        <EmptyState
                            icon={<Users size={26} />}
                            title="No groups yet"
                            description="Create a group for your next trip or your flat, or join one with an invite link from a friend."
                            actionLabel="Create your first group"
                            onAction={() => setSheet('create')}
                        />
                    </StaggerItem>
                ) : (
                    <StaggerItem className={styles.list}>
                        {groups.map((group, index) => {
                            const net = balances.byGroup[group.id]?.net ?? 0;
                            return (
                                <motion.div
                                    key={group.id}
                                    initial={{ opacity: 0, y: 12 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: Math.min(index * 0.05, 0.3), type: 'spring', stiffness: 340, damping: 30 }}
                                >
                                    <Link href={`/groups/${group.id}`} className={styles.card}>
                                        <div className={styles.cardBody}>
                                            <div className={styles.cardTop}>
                                                <span className={styles.emoji}>{group.emoji}</span>
                                                <div className={styles.cardText}>
                                                    <span className={styles.name}>{group.name}</span>
                                                    <span className={styles.meta}>
                                                        {group.members.length} member{group.members.length === 1 ? '' : 's'} · active {timeAgo(group.updatedAt)}
                                                    </span>
                                                </div>
                                                <ChevronRight size={18} className={styles.chevron} />
                                            </div>
                                            <div className={styles.cardBottom}>
                                                <AvatarGroup
                                                    users={group.members.map((member) => ({ name: member.user?.name || 'Member', image: member.user?.image }))}
                                                    max={5}
                                                    size="sm"
                                                />
                                                <div className={styles.total}>
                                                    <span className={styles.totalLabel}>Total spent</span>
                                                    <span className={styles.totalValue}>{formatCurrency(group.totalSpent || 0)}</span>
                                                </div>
                                            </div>
                                        </div>
                                        <div
                                            className={cn(
                                                styles.strip,
                                                net > 0 && styles.stripSuccess,
                                                net < 0 && styles.stripDanger,
                                            )}
                                        >
                                            <span className={styles.stripLabel}>
                                                {net > 0 ? <ArrowDownLeft size={15} /> : net < 0 ? <ArrowUpRight size={15} /> : <CheckCheck size={15} />}
                                                {net > 0 ? 'You get back' : net < 0 ? 'You owe' : 'You’re settled up'}
                                            </span>
                                            {net !== 0 && <span className={styles.stripAmount}>{formatCurrency(Math.abs(net))}</span>}
                                        </div>
                                    </Link>
                                </motion.div>
                            );
                        })}
                    </StaggerItem>
                )}
            </Stagger>

            {/* ── Create group ── */}
            <Modal
                isOpen={sheet === 'create'}
                onClose={closeSheet}
                title={createdGroup ? 'Invite your people' : 'New group'}
                size="small"
            >
                <AnimatePresence mode="wait" initial={false}>
                    {!createdGroup ? (
                        <motion.div
                            key="create"
                            className={styles.sheet}
                            initial={{ opacity: 0, x: -12 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -12 }}
                            transition={{ duration: 0.18 }}
                        >
                            <motion.span
                                key={selectedEmoji}
                                className={styles.emojiPreview}
                                initial={{ scale: 0.8, rotate: -8 }}
                                animate={{ scale: 1, rotate: 0 }}
                                transition={{ type: 'spring', stiffness: 460, damping: 18 }}
                            >
                                {selectedEmoji}
                            </motion.span>

                            <Input
                                label="Group name"
                                placeholder="e.g. Goa Trip 2026"
                                value={groupName}
                                maxLength={50}
                                onChange={(event) => setGroupName(event.target.value)}
                                onKeyDown={(event) => { if (event.key === 'Enter') handleCreate(); }}
                                leftIcon={<Users size={18} />}
                                autoFocus
                            />

                            <div>
                                <span className={styles.fieldLabel}>Pick an icon</span>
                                <div className={styles.emojiGrid}>
                                    {GROUP_EMOJIS.map((emoji) => (
                                        <motion.button
                                            key={emoji}
                                            type="button"
                                            whileTap={{ scale: 0.86 }}
                                            onClick={() => setSelectedEmoji(emoji)}
                                            className={cn(styles.emojiOption, selectedEmoji === emoji && styles.emojiOptionActive)}
                                            aria-label={`Use ${emoji} as the group icon`}
                                            aria-pressed={selectedEmoji === emoji}
                                        >
                                            {emoji}
                                        </motion.button>
                                    ))}
                                </div>
                            </div>

                            <Button fullWidth size="lg" disabled={!groupName.trim()} loading={creating} onClick={handleCreate}>
                                Create group
                            </Button>
                        </motion.div>
                    ) : (
                        <motion.div
                            key="invite"
                            className={styles.sheet}
                            initial={{ opacity: 0, x: 12 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: 12 }}
                            transition={{ duration: 0.18 }}
                        >
                            <div className={styles.success}>
                                <motion.span
                                    className={styles.successBadge}
                                    initial={{ scale: 0, rotate: -20 }}
                                    animate={{ scale: 1, rotate: 0 }}
                                    transition={{ type: 'spring', stiffness: 420, damping: 16 }}
                                >
                                    <Check size={30} strokeWidth={3} />
                                </motion.span>
                                <p className={styles.successTitle}>{selectedEmoji} {groupName.trim()} is ready</p>
                                <p className={styles.successText}>Share this link or let friends scan the code to join instantly.</p>
                            </div>

                            <div className={styles.qr}>
                                <QRCodeSVG value={createdGroup.inviteLink} size={148} level="M" bgColor="#ffffff" fgColor="#0d0f14" />
                            </div>

                            <div className={styles.linkBox}>
                                <Link2 size={16} style={{ color: 'var(--fg-muted)', flexShrink: 0 }} />
                                <span className={styles.linkText}>{createdGroup.inviteLink}</span>
                                <Button size="sm" variant={copied ? 'soft' : 'secondary'} onClick={handleCopy} leftIcon={copied ? <Check size={14} /> : <Copy size={14} />}>
                                    {copied ? 'Copied' : 'Copy'}
                                </Button>
                            </div>

                            <div className={styles.twoUp}>
                                <Button fullWidth variant="secondary" leftIcon={<Contact size={16} />} onClick={() => router.push('/contacts')}>
                                    Contacts
                                </Button>
                                <Button fullWidth leftIcon={<Share2 size={16} />} onClick={handleShare}>
                                    Share
                                </Button>
                            </div>

                            <Button fullWidth variant="ghost" onClick={() => {
                                const id = createdGroup.id;
                                closeSheet();
                                router.push(`/groups/${id}`);
                            }}>
                                Open group
                            </Button>
                        </motion.div>
                    )}
                </AnimatePresence>
            </Modal>

            {/* ── Join group ── */}
            <Modal isOpen={sheet === 'join'} onClose={closeSheet} title="Join a group" size="small">
                <div className={styles.sheet}>
                    <p className={styles.hint}>Paste the invite link or code a friend shared with you.</p>
                    <Input
                        label="Invite link or code"
                        placeholder="splitx.app/join/abc123"
                        value={joinInput}
                        onChange={(event) => setJoinInput(event.target.value)}
                        onKeyDown={(event) => { if (event.key === 'Enter') handleJoin(); }}
                        leftIcon={<Link2 size={18} />}
                        autoFocus
                    />
                    <Button fullWidth size="lg" disabled={!joinInput.trim()} loading={joining} onClick={handleJoin} leftIcon={<LogIn size={17} />}>
                        Join group
                    </Button>
                </div>
            </Modal>
        </>
    );
}
