'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, UserPlus, Link2, Copy, Check, Users, Inbox, ArrowRight, Sparkles } from 'lucide-react';
import Button from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import Modal from '@/components/ui/Modal';
import { AvatarGroup } from '@/components/ui/Avatar';
import { useToast } from '@/components/ui/Toast';
import { formatCurrency, timeAgo } from '@/lib/utils';

const GROUP_EMOJIS = ['✈️', '🏖️', '🏠', '🍕', '🎮', '🏕️', '🎉', '🚗', '💼', '🎓', '🏋️', '🎵'];

/* ── Glassmorphic styles ── */
const glass: React.CSSProperties = {
    background: 'var(--bg-glass)',
    backdropFilter: 'blur(24px) saturate(1.5)',
    WebkitBackdropFilter: 'blur(24px) saturate(1.5)',
    border: '1px solid var(--border-glass)',
    borderRadius: 'var(--radius-2xl)',
    boxShadow: 'var(--shadow-card)',
    position: 'relative',
    overflow: 'hidden',
};

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
    const [groups, setGroups] = useState<GroupData[]>([]);
    const [loading, setLoading] = useState(true);
    const [showCreate, setShowCreate] = useState(false);
    const [creating, setCreating] = useState(false);
    const [groupName, setGroupName] = useState('');
    const [selectedEmoji, setSelectedEmoji] = useState('✈️');
    const [inviteLink, setInviteLink] = useState('');
    const [copied, setCopied] = useState(false);
    const { toast } = useToast();

    const fetchGroups = useCallback(async () => {
        try {
            const res = await fetch('/api/groups');
            if (res.ok) {
                const data = await res.json();
                setGroups(Array.isArray(data) ? data : []);
            }
        } catch (err) {
            console.error('Failed to fetch groups:', err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchGroups(); }, [fetchGroups]);

    const handleCreate = async () => {
        if (!groupName.trim() || creating) return;
        setCreating(true);
        try {
            const res = await fetch('/api/groups', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: groupName.trim(), emoji: selectedEmoji }),
            });
            if (res.ok) {
                const group = await res.json();
                setInviteLink(`${window.location.origin}/join/${group.inviteCode}`);
                toast('Group created! 🎉 Share the invite link', 'success');
                fetchGroups();
            } else {
                toast('Failed to create group — try again', 'error');
            }
        } catch (err) {
            console.error('Failed to create group:', err);
            toast('Network error — please check your connection', 'error');
        } finally {
            setCreating(false);
        }
    };

    const handleCopy = () => {
        navigator.clipboard.writeText(inviteLink);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    if (loading) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', padding: 'var(--space-4) 0' }}>
                {[1, 2, 3].map(i => (
                    <div key={i} style={{
                        ...glass, padding: 'var(--space-4)',
                        animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
                        animationDelay: `${i * 150}ms`,
                    }}>
                        <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
                            <div style={{ width: 50, height: 50, borderRadius: 'var(--radius-xl)', background: 'rgba(var(--accent-500-rgb), 0.06)' }} />
                            <div style={{ flex: 1 }}>
                                <div style={{ width: '60%', height: 14, borderRadius: 8, background: 'rgba(var(--accent-500-rgb), 0.08)', marginBottom: 8 }} />
                                <div style={{ width: '40%', height: 10, borderRadius: 6, background: 'rgba(var(--accent-500-rgb), 0.05)' }} />
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        );
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
            {/* ═══ HEADER — Gradient title + glass New Group button ═══ */}
            <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
            >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                            <Sparkles size={14} style={{ color: 'var(--accent-400)' }} />
                            <span style={{
                                fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)',
                                fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em',
                            }}>
                                Groups
                            </span>
                        </div>
                        <h2 style={{
                            fontSize: 'var(--text-xl)', fontWeight: 800,
                            background: 'linear-gradient(135deg, var(--fg-primary), var(--accent-400))',
                            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
                        }}>
                            Your Groups
                        </h2>
                        <p style={{ color: 'var(--fg-tertiary)', fontSize: 'var(--text-xs)', marginTop: 2 }}>
                            {groups.length} group{groups.length !== 1 ? 's' : ''} · Split expenses together
                        </p>
                    </div>
                    <button
                        onClick={() => setShowCreate(true)}
                        style={{
                            display: 'flex', alignItems: 'center', gap: 6,
                            padding: '8px 14px', borderRadius: 'var(--radius-full)',
                            background: 'linear-gradient(135deg, var(--accent-500), var(--accent-600))',
                            border: 'none', color: 'white', fontSize: 'var(--text-xs)', fontWeight: 700,
                            cursor: 'pointer', boxShadow: '0 4px 16px rgba(var(--accent-500-rgb), 0.3)',
                            transition: 'all 0.2s',
                        }}
                    >
                        <Plus size={14} /> New Group
                    </button>
                </div>
            </motion.div>

            {/* ═══ GROUP CARDS — Glassmorphic with emoji hero ═══ */}
            {groups.length === 0 ? (
                <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}>
                    <div style={{
                        ...glass, padding: 'var(--space-10) var(--space-4)',
                        textAlign: 'center',
                        background: 'linear-gradient(135deg, rgba(var(--accent-500-rgb), 0.04), var(--bg-glass))',
                    }}>
                        <div style={{ position: 'relative', zIndex: 1 }}>
                            <div style={{
                                width: 64, height: 64, borderRadius: 'var(--radius-2xl)',
                                background: 'rgba(var(--accent-500-rgb), 0.08)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                margin: '0 auto var(--space-4)', color: 'var(--accent-400)',
                            }}>
                                <Inbox size={28} />
                            </div>
                            <h3 style={{ fontSize: 'var(--text-base)', fontWeight: 700, marginBottom: 4 }}>No groups yet</h3>
                            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-tertiary)', marginBottom: 'var(--space-5)' }}>
                                Create your first group to start splitting
                            </p>
                            <Button size="sm" leftIcon={<Plus size={14} />} onClick={() => setShowCreate(true)}
                                style={{
                                    background: 'linear-gradient(135deg, var(--accent-500), var(--accent-600))',
                                    boxShadow: '0 4px 20px rgba(var(--accent-500-rgb), 0.3)',
                                }}
                            >
                                Create Group
                            </Button>
                        </div>
                    </div>
                </motion.div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                    {groups.map((group, i) => (
                        <motion.a
                            key={group.id}
                            href={`/groups/${group.id}`}
                            style={{ textDecoration: 'none' }}
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: i * 0.06, duration: 0.4 }}
                        >
                            <div style={{
                                ...glass, padding: 'var(--space-4)',
                                cursor: 'pointer',
                                transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
                            }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.transform = 'translateY(-3px) scale(1.005)';
                                    e.currentTarget.style.boxShadow = 'var(--shadow-card-hover)';
                                    e.currentTarget.style.borderColor = 'rgba(var(--accent-500-rgb), 0.18)';
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.transform = 'translateY(0) scale(1)';
                                    e.currentTarget.style.boxShadow = '';
                                    e.currentTarget.style.borderColor = 'var(--border-glass)';
                                }}
                            >
                                {/* Top light edge */}
                                <div style={{
                                    position: 'absolute', top: 0, left: '15%', right: '15%', height: 1,
                                    background: 'linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.08), transparent)',
                                    pointerEvents: 'none',
                                }} />
                                <div style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                                    {/* Emoji with gradient bg */}
                                    <div style={{
                                        width: 50, height: 50, borderRadius: 'var(--radius-xl)',
                                        background: 'linear-gradient(135deg, rgba(var(--accent-500-rgb), 0.12), rgba(var(--accent-500-rgb), 0.03))',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        fontSize: 26, flexShrink: 0,
                                        boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.06)',
                                    }}>
                                        {group.emoji}
                                    </div>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{
                                            fontSize: 'var(--text-sm)', fontWeight: 700,
                                            color: 'var(--fg-primary)', marginBottom: 3,
                                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                        }}>
                                            {group.name}
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                                            <span style={{
                                                fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)',
                                                display: 'flex', alignItems: 'center', gap: 3,
                                            }}>
                                                <Users size={11} /> {group.members.length}
                                            </span>
                                            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-muted)' }}>·</span>
                                            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)' }}>
                                                {timeAgo(group.updatedAt)}
                                            </span>
                                        </div>
                                    </div>
                                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                                        <div style={{
                                            fontSize: 'var(--text-sm)', fontWeight: 700,
                                            background: 'linear-gradient(135deg, var(--accent-400), var(--accent-500))',
                                            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
                                            marginBottom: 4,
                                        }}>
                                            {group.totalSpent ? formatCurrency(group.totalSpent) : '₹0'}
                                        </div>
                                        <AvatarGroup users={group.members.map(m => ({ name: m.user?.name || 'User', image: m.user?.image }))} max={3} size="xs" />
                                    </div>
                                </div>
                            </div>
                        </motion.a>
                    ))}
                </div>
            )}

            {/* ═══ CREATE GROUP MODAL — Glassmorphic ═══ */}
            <Modal
                isOpen={showCreate}
                onClose={() => { setShowCreate(false); setInviteLink(''); setGroupName(''); }}
                title={inviteLink ? 'Invite Members' : 'New Group'}
                size="small"
            >
                <AnimatePresence mode="wait">
                    {!inviteLink ? (
                        <motion.div
                            key="create"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0, x: -20 }}
                            style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}
                        >
                            <Input
                                label="Group Name"
                                placeholder="e.g. Goa Trip 2026"
                                value={groupName}
                                onChange={(e) => setGroupName(e.target.value)}
                                leftIcon={<Users size={18} />}
                            />

                            {/* Emoji Picker — Glass grid */}
                            <div>
                                <label style={{
                                    display: 'block', fontSize: 'var(--text-sm)', fontWeight: 600,
                                    color: 'var(--fg-secondary)', marginBottom: 'var(--space-2)',
                                }}>
                                    Group Icon
                                </label>
                                <div style={{
                                    display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)',
                                    gap: 'var(--space-2)',
                                }}>
                                    {GROUP_EMOJIS.map((emoji) => (
                                        <motion.button
                                            key={emoji}
                                            whileTap={{ scale: 0.85 }}
                                            onClick={() => setSelectedEmoji(emoji)}
                                            style={{
                                                width: '100%', aspectRatio: '1',
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                fontSize: 22,
                                                border: selectedEmoji === emoji
                                                    ? '2px solid var(--accent-500)'
                                                    : '1px solid var(--border-default)',
                                                borderRadius: 'var(--radius-lg)',
                                                background: selectedEmoji === emoji
                                                    ? 'rgba(var(--accent-500-rgb), 0.12)'
                                                    : 'transparent',
                                                cursor: 'pointer',
                                                transition: 'all 0.15s',
                                                boxShadow: selectedEmoji === emoji
                                                    ? '0 0 12px rgba(var(--accent-500-rgb), 0.15)'
                                                    : 'none',
                                            }}
                                        >
                                            {emoji}
                                        </motion.button>
                                    ))}
                                </div>
                            </div>

                            <Button
                                fullWidth size="lg"
                                disabled={!groupName.trim()}
                                onClick={handleCreate}
                                style={{
                                    background: 'linear-gradient(135deg, var(--accent-500), var(--accent-600))',
                                    boxShadow: '0 4px 20px rgba(var(--accent-500-rgb), 0.3)',
                                }}
                            >
                                {creating ? 'Creating...' : 'Create Group'}
                            </Button>
                        </motion.div>
                    ) : (
                        <motion.div
                            key="invite"
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', textAlign: 'center' }}
                        >
                            <div style={{ fontSize: 48, margin: 'var(--space-2) 0' }}>🎉</div>
                            <p style={{ color: 'var(--fg-secondary)', fontSize: 'var(--text-sm)' }}>
                                Share this link with your friends:
                            </p>

                            <div style={{
                                display: 'flex', gap: 'var(--space-2)',
                                background: 'var(--bg-glass)', backdropFilter: 'blur(12px)',
                                WebkitBackdropFilter: 'blur(12px)',
                                padding: 'var(--space-2) var(--space-3)',
                                borderRadius: 'var(--radius-xl)',
                                border: '1px solid var(--border-glass)',
                                alignItems: 'center',
                            }}>
                                <Link2 size={16} style={{ color: 'var(--accent-400)', flexShrink: 0 }} />
                                <span style={{
                                    flex: 1, fontSize: 'var(--text-xs)',
                                    color: 'var(--fg-primary)',
                                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                }}>
                                    {inviteLink}
                                </span>
                                <Button size="sm" variant={copied ? 'ghost' : 'primary'} iconOnly onClick={handleCopy}>
                                    {copied ? <Check size={14} /> : <Copy size={14} />}
                                </Button>
                            </div>

                            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                                <Button fullWidth variant="secondary" onClick={() => {
                                    setShowCreate(false); setInviteLink(''); setGroupName('');
                                }}>
                                    Done
                                </Button>
                                <Button fullWidth leftIcon={<UserPlus size={14} />}
                                    style={{
                                        background: 'linear-gradient(135deg, var(--accent-500), var(--accent-600))',
                                        boxShadow: '0 4px 20px rgba(var(--accent-500-rgb), 0.3)',
                                    }}
                                >
                                    Share
                                </Button>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </Modal>
        </div>
    );
}
