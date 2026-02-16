'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Users, Check, Loader2 } from 'lucide-react';
import Button from '@/components/ui/Button';

interface GroupPreview {
    id: string;
    name: string;
    emoji: string;
    _count: { members: number };
}

export default function JoinGroupPage() {
    const params = useParams();
    const router = useRouter();
    const code = params.code as string;

    const [group, setGroup] = useState<GroupPreview | null>(null);
    const [loading, setLoading] = useState(true);
    const [joining, setJoining] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);

    useEffect(() => {
        async function loadGroup() {
            try {
                const res = await fetch(`/api/groups/join?code=${encodeURIComponent(code)}`);
                if (res.ok) {
                    setGroup(await res.json());
                } else {
                    setError('Invalid or expired invite link');
                }
            } catch {
                setError('Unable to load invite');
            } finally {
                setLoading(false);
            }
        }
        if (code) loadGroup();
    }, [code]);

    const handleJoin = async () => {
        setJoining(true);
        try {
            const res = await fetch('/api/groups/join', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ inviteCode: code }),
            });

            if (res.status === 401) {
                // Not logged in — redirect to login with return URL
                router.push(`/login?callbackUrl=${encodeURIComponent(`/join/${code}`)}`);
                return;
            }

            const data = await res.json();
            if (res.ok || data.message === 'Already a member') {
                setSuccess(true);
                setTimeout(() => router.push(`/groups`), 1500);
            } else {
                setError(data.error || 'Failed to join group');
            }
        } catch {
            setError('Network error — please try again');
        } finally {
            setJoining(false);
        }
    };

    return (
        <div style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 'var(--space-4)',
            background: 'var(--bg-primary)',
        }}>
            <motion.div
                initial={{ opacity: 0, y: 20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ type: 'spring', stiffness: 300, damping: 25 }}
                style={{
                    maxWidth: 400,
                    width: '100%',
                    padding: 'var(--space-8)',
                    borderRadius: 'var(--radius-2xl)',
                    background: 'var(--surface-card)',
                    border: '1px solid var(--border-default)',
                    textAlign: 'center',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 'var(--space-4)',
                }}
            >
                {loading ? (
                    <Loader2 size={40} style={{ animation: 'spin 1s linear infinite', color: 'var(--accent-500)' }} />
                ) : error && !group ? (
                    <>
                        <div style={{ fontSize: 48 }}>😕</div>
                        <h2 style={{ color: 'var(--fg-primary)', fontSize: 'var(--text-xl)', fontWeight: 'var(--weight-bold)' }}>
                            Invalid Invite
                        </h2>
                        <p style={{ color: 'var(--fg-tertiary)', fontSize: 'var(--text-sm)' }}>{error}</p>
                        <Button onClick={() => router.push('/dashboard')}>Go to Dashboard</Button>
                    </>
                ) : success ? (
                    <>
                        <motion.div
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            transition={{ type: 'spring', stiffness: 400, damping: 15, delay: 0.1 }}
                            style={{
                                width: 64,
                                height: 64,
                                borderRadius: '50%',
                                background: 'linear-gradient(135deg, var(--color-success), #2dd4bf)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                            }}
                        >
                            <Check size={32} color="white" />
                        </motion.div>
                        <h2 style={{ color: 'var(--fg-primary)', fontSize: 'var(--text-xl)', fontWeight: 'var(--weight-bold)' }}>
                            You&apos;re in!
                        </h2>
                        <p style={{ color: 'var(--fg-tertiary)', fontSize: 'var(--text-sm)' }}>
                            Redirecting to your groups...
                        </p>
                    </>
                ) : group && (
                    <>
                        <div style={{ fontSize: 56 }}>{group.emoji}</div>
                        <h2 style={{ color: 'var(--fg-primary)', fontSize: 'var(--text-xl)', fontWeight: 'var(--weight-bold)' }}>
                            Join {group.name}?
                        </h2>
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 'var(--space-2)',
                            color: 'var(--fg-tertiary)',
                            fontSize: 'var(--text-sm)',
                        }}>
                            <Users size={16} />
                            <span>{group._count.members} member{group._count.members !== 1 ? 's' : ''}</span>
                        </div>
                        {error && (
                            <p style={{ color: 'var(--color-error)', fontSize: 'var(--text-sm)' }}>{error}</p>
                        )}
                        <Button
                            fullWidth
                            size="lg"
                            loading={joining}
                            onClick={handleJoin}
                        >
                            Join Group
                        </Button>
                    </>
                )}
            </motion.div>
        </div>
    );
}
