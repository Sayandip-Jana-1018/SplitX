'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import useSWR from 'swr';
import { motion } from 'framer-motion';
import { ArrowRightLeft, Bell, Check, Link2Off, ReceiptText, RotateCcw, Users, WifiOff } from 'lucide-react';
import Button from '@/components/ui/Button';
import { Notice, Spinner } from '@/components/ui/kit';
import { AuthCard, PublicShell, apiErrorMessage } from '@/components/auth/AuthKit';
import { cn } from '@/lib/utils';
import styles from '@/components/auth/auth.module.css';

interface GroupPreview {
    id: string;
    name: string;
    emoji: string;
    _count: { members: number };
}

/** Resolves to null when the invite code is unknown or expired. */
async function previewFetcher(url: string): Promise<GroupPreview | null> {
    const response = await fetch(url);
    if (!response.ok) {
        if (response.status >= 500) throw new Error('Server error');
        return null;
    }
    return response.json();
}

export default function JoinGroupPage() {
    const params = useParams();
    const router = useRouter();
    const code = params.code as string;
    const { data: group, error, isLoading, mutate } = useSWR(
        code ? `/api/groups/join?code=${encodeURIComponent(code)}` : null,
        previewFetcher,
        { revalidateOnFocus: false }
    );
    const [joining, setJoining] = useState(false);
    const [joinError, setJoinError] = useState('');
    const [joined, setJoined] = useState(false);

    const join = async () => {
        setJoining(true);
        setJoinError('');
        try {
            const res = await fetch('/api/groups/join', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ inviteCode: code }),
            });
            if (res.status === 401) {
                router.push(`/login?callbackUrl=${encodeURIComponent(`/join/${code}`)}`);
                return;
            }
            const data = await res.json().catch(() => null);
            if (res.ok || data?.message === 'Already a member') {
                setJoined(true);
                window.setTimeout(() => router.push(group ? `/groups/${group.id}` : '/groups'), 1400);
            } else {
                setJoinError(apiErrorMessage(data, 'We couldn’t add you to this group. Please try again.'));
            }
        } catch {
            setJoinError('Network error — please try again.');
        } finally {
            setJoining(false);
        }
    };

    let content;
    if (isLoading) {
        content = (
            <AuthCard key="loading" title="Opening your invite…">
                <div className={styles.loadingBlock}><Spinner size={28} /></div>
            </AuthCard>
        );
    } else if (error) {
        content = (
            <AuthCard
                key="error"
                icon={<span className={cn(styles.stateIcon, styles.stateDanger)}><WifiOff size={30} /></span>}
                title="Couldn’t load this invite"
                subtitle="Check your connection and try again."
            >
                <Button fullWidth size="lg" leftIcon={<RotateCcw size={17} />} onClick={() => mutate()}>Try again</Button>
            </AuthCard>
        );
    } else if (!group) {
        content = (
            <AuthCard
                key="invalid"
                icon={<span className={cn(styles.stateIcon, styles.stateDanger)}><Link2Off size={30} /></span>}
                title="This invite has expired"
                subtitle="Ask a friend in the group to share a fresh link."
            >
                <Button fullWidth size="lg" onClick={() => router.push('/dashboard')}>Go to SplitX</Button>
            </AuthCard>
        );
    } else if (joined) {
        content = (
            <AuthCard
                key="joined"
                icon={(
                    <motion.span
                        className={cn(styles.stateIcon, styles.stateSuccess)}
                        initial={{ scale: 0.4, rotate: -14 }}
                        animate={{ scale: 1, rotate: 0 }}
                        transition={{ type: 'spring', stiffness: 420, damping: 15 }}
                    >
                        <Check size={34} strokeWidth={3} />
                    </motion.span>
                )}
                title="You’re in!"
                subtitle={<>Opening <strong>{group.name}</strong>…</>}
            />
        );
    } else {
        const members = group._count.members;
        content = (
            <AuthCard
                key="invite"
                icon={(
                    <div className={styles.joinHead}>
                        <motion.span
                            className={styles.groupEmoji}
                            initial={{ scale: 0.6, rotate: -10 }}
                            animate={{ scale: 1, rotate: 0 }}
                            transition={{ type: 'spring', stiffness: 380, damping: 16 }}
                        >
                            {group.emoji}
                        </motion.span>
                        <span className={styles.eyebrow}>You’re invited to join</span>
                    </div>
                )}
                title={group.name}
                subtitle={`${members} ${members === 1 ? 'person is' : 'people are'} already splitting here.`}
            >
                <ul className={styles.perks}>
                    <li className={styles.perk}><ReceiptText size={17} />See shared expenses as they’re added</li>
                    <li className={styles.perk}><ArrowRightLeft size={17} />Know exactly who owes whom</li>
                    <li className={styles.perk}><Bell size={17} />Settle up by UPI and get nudges</li>
                </ul>
                {joinError && <Notice tone="danger">{joinError}</Notice>}
                <div className={styles.actions}>
                    <Button fullWidth size="lg" loading={joining} leftIcon={<Users size={18} />} onClick={join}>
                        Join group
                    </Button>
                    <Button fullWidth variant="ghost" onClick={() => router.push('/dashboard')} disabled={joining}>
                        Not now
                    </Button>
                </div>
            </AuthCard>
        );
    }

    return <PublicShell>{content}</PublicShell>;
}
