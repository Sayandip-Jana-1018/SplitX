'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell, Check, CheckCheck, X, Receipt, Users, ArrowRightLeft, Clock, Send, Loader2 } from 'lucide-react';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { useRouter } from 'next/navigation';

interface Notification {
    id: string;
    type: string;
    title: string;
    body: string;
    read: boolean;
    link?: string;
    createdAt: string;
}

const TYPE_ICONS: Record<string, React.ReactNode> = {
    new_expense: <Receipt size={15} />,
    payment_reminder: <Clock size={15} />,
    settlement_completed: <ArrowRightLeft size={15} />,
    group_activity: <Users size={15} />,
    group_invite: <Send size={15} />,
    group_invite_accepted: <CheckCheck size={15} />,
    member_joined: <Users size={15} />,
};

const TYPE_COLORS: Record<string, string> = {
    new_expense: 'var(--accent-400)',
    payment_reminder: '#f59e0b',
    settlement_completed: '#10b981',
    group_activity: '#3b82f6',
    group_invite: '#8b5cf6',
    group_invite_accepted: '#10b981',
    member_joined: '#3b82f6',
};

const TYPE_GRADIENTS: Record<string, string> = {
    new_expense: 'linear-gradient(135deg, rgba(var(--accent-500-rgb), 0.15), rgba(var(--accent-500-rgb), 0.05))',
    payment_reminder: 'linear-gradient(135deg, rgba(245, 158, 11, 0.15), rgba(245, 158, 11, 0.05))',
    settlement_completed: 'linear-gradient(135deg, rgba(16, 185, 129, 0.15), rgba(16, 185, 129, 0.05))',
    group_activity: 'linear-gradient(135deg, rgba(59, 130, 246, 0.15), rgba(59, 130, 246, 0.05))',
    group_invite: 'linear-gradient(135deg, rgba(139, 92, 246, 0.15), rgba(139, 92, 246, 0.05))',
    group_invite_accepted: 'linear-gradient(135deg, rgba(16, 185, 129, 0.15), rgba(16, 185, 129, 0.05))',
    member_joined: 'linear-gradient(135deg, rgba(59, 130, 246, 0.15), rgba(59, 130, 246, 0.05))',
};

function timeAgo(dateStr: string): string {
    const now = Date.now();
    const date = new Date(dateStr).getTime();
    const diff = Math.floor((now - date) / 1000);
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
}

export default function NotificationPanel() {
    const [open, setOpen] = useState(false);
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const [mounted, setMounted] = useState(false);
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const router = useRouter();

    // ── Invitation accept/decline ──
    const handleInvitationAction = async (notif: Notification, status: 'accepted' | 'declined') => {
        if (!notif.link) return;
        const invitationId = notif.link.split('/').pop();
        if (!invitationId) return;

        setActionLoading(`${notif.id}-${status}`);
        try {
            const res = await fetch(`/api/invitations/${invitationId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status }),
            });
            const data = await res.json();

            await fetch('/api/notifications', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids: [notif.id] }),
            });

            setNotifications(prev =>
                prev.map(n => n.id === notif.id ? { ...n, read: true } : n)
            );
            setUnreadCount(prev => Math.max(0, prev - 1));

            if (status === 'accepted' && data.groupId) {
                setOpen(false);
                router.push(`/groups/${data.groupId}`);
            }

            setTimeout(fetchNotifications, 500);
        } catch {
            // silent
        } finally {
            setActionLoading(null);
        }
    };

    useEffect(() => { setMounted(true); }, []);

    const fetchNotifications = useCallback(async () => {
        try {
            const res = await fetch('/api/notifications');
            if (res.ok) {
                const data = await res.json();
                setNotifications(data.data || []);
                setUnreadCount(data.unreadCount || 0);
            }
        } catch { /* silent */ }
    }, []);

    useEffect(() => {
        if (!mounted) return;
        fetchNotifications();
        const interval = setInterval(fetchNotifications, 30_000);
        return () => clearInterval(interval);
    }, [mounted, fetchNotifications]);

    useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent) => {
            if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [open]);

    const markAllRead = async () => {
        try {
            await fetch('/api/notifications', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ markAll: true }),
            });
            setNotifications(prev => prev.map(n => ({ ...n, read: true })));
            setUnreadCount(0);
        } catch { /* silent */ }
    };

    const handleNotificationClick = async (notif: Notification) => {
        if (!notif.read) {
            try {
                await fetch('/api/notifications', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ids: [notif.id] }),
                });
                setNotifications(prev =>
                    prev.map(n => n.id === notif.id ? { ...n, read: true } : n)
                );
                setUnreadCount(prev => Math.max(0, prev - 1));
            } catch { /* silent */ }
        }

        if (notif.link) {
            setOpen(false);
            router.push(notif.link);
        }
    };

    if (!isFeatureEnabled('notifications')) return null;

    return (
        <div ref={panelRef} style={{ position: 'relative' }} suppressHydrationWarning>
            {mounted && (
                <>
                    {/* Bell icon button */}
                    <button
                        onClick={() => setOpen(!open)}
                        style={{
                            width: 34,
                            height: 34,
                            position: 'relative',
                            borderRadius: 'var(--radius-lg)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background: 'rgba(var(--accent-500-rgb), 0.08)',
                            backdropFilter: 'blur(12px)',
                            WebkitBackdropFilter: 'blur(12px)',
                            border: '1px solid rgba(var(--accent-500-rgb), 0.12)',
                            color: 'var(--accent-500)',
                            cursor: 'pointer',
                            transition: 'all 0.2s ease',
                            padding: 0,
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.background = 'rgba(var(--accent-500-rgb), 0.15)';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'rgba(var(--accent-500-rgb), 0.08)';
                        }}
                        aria-label="Notifications"
                    >
                        <Bell size={16} />
                        {unreadCount > 0 && (
                            <motion.span
                                initial={{ scale: 0 }}
                                animate={{ scale: 1 }}
                                style={{
                                    position: 'absolute',
                                    top: -2, right: -2,
                                    minWidth: 18, height: 18,
                                    borderRadius: 9,
                                    background: 'linear-gradient(135deg, #ef4444, #dc2626)',
                                    color: '#fff',
                                    fontSize: 10,
                                    fontWeight: 700,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    border: '2px solid var(--bg-primary)',
                                    padding: '0 4px',
                                    lineHeight: 1,
                                }}
                            >
                                {unreadCount > 9 ? '9+' : unreadCount}
                            </motion.span>
                        )}
                    </button>

                    {/* ── Dropdown Panel ── */}
                    <AnimatePresence>
                        {open && (
                            <motion.div
                                initial={{ opacity: 0, y: -10, scale: 0.96 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                exit={{ opacity: 0, y: -10, scale: 0.96 }}
                                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                                style={{
                                    position: 'fixed',
                                    top: 68,
                                    right: 16,
                                    width: 370,
                                    maxWidth: 'calc(100vw - 32px)',
                                    maxHeight: 480,
                                    background: 'var(--surface-popover)',
                                    backdropFilter: 'blur(28px) saturate(1.6)',
                                    WebkitBackdropFilter: 'blur(28px) saturate(1.6)',
                                    border: '1px solid var(--border-glass)',
                                    borderRadius: 16,
                                    boxShadow: '0 20px 60px rgba(0,0,0,0.15), 0 4px 20px rgba(0,0,0,0.08)',
                                    overflow: 'hidden',
                                    zIndex: 100,
                                    display: 'flex',
                                    flexDirection: 'column',
                                }}
                            >
                                {/* ── Header ── */}
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    padding: '16px 18px 12px',
                                    borderBottom: '1px solid var(--border-subtle)',
                                }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <span style={{
                                            fontSize: 15,
                                            fontWeight: 700,
                                            color: 'var(--fg-primary)',
                                            letterSpacing: '-0.01em',
                                        }}>
                                            Notifications
                                        </span>
                                        {unreadCount > 0 && (
                                            <span style={{
                                                fontSize: 11,
                                                fontWeight: 700,
                                                color: '#fff',
                                                background: 'var(--accent-500)',
                                                borderRadius: 10,
                                                padding: '1px 7px',
                                                lineHeight: '16px',
                                            }}>
                                                {unreadCount}
                                            </span>
                                        )}
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                        {unreadCount > 0 && (
                                            <button
                                                onClick={markAllRead}
                                                style={{
                                                    background: 'none', border: 'none',
                                                    color: 'var(--accent-500)',
                                                    fontSize: 12, fontWeight: 600,
                                                    cursor: 'pointer', padding: '4px 8px',
                                                    borderRadius: 'var(--radius-md)',
                                                    display: 'flex', alignItems: 'center', gap: 4,
                                                    transition: 'background 0.15s',
                                                }}
                                                onMouseEnter={(e) => {
                                                    e.currentTarget.style.background = 'rgba(var(--accent-500-rgb), 0.08)';
                                                }}
                                                onMouseLeave={(e) => {
                                                    e.currentTarget.style.background = 'transparent';
                                                }}
                                            >
                                                <CheckCheck size={13} />
                                                Mark all read
                                            </button>
                                        )}
                                        <button
                                            onClick={() => setOpen(false)}
                                            style={{
                                                background: 'none', border: 'none',
                                                color: 'var(--fg-tertiary)', cursor: 'pointer',
                                                padding: 6, display: 'flex',
                                                borderRadius: 'var(--radius-md)',
                                                transition: 'all 0.15s',
                                            }}
                                            onMouseEnter={(e) => {
                                                e.currentTarget.style.background = 'rgba(var(--accent-500-rgb), 0.06)';
                                                e.currentTarget.style.color = 'var(--fg-primary)';
                                            }}
                                            onMouseLeave={(e) => {
                                                e.currentTarget.style.background = 'transparent';
                                                e.currentTarget.style.color = 'var(--fg-tertiary)';
                                            }}
                                        >
                                            <X size={15} />
                                        </button>
                                    </div>
                                </div>

                                {/* ── Notification List ── */}
                                <div style={{
                                    overflowY: 'auto', flex: 1,
                                    padding: '4px 0',
                                }}>
                                    {notifications.length === 0 ? (
                                        <div style={{
                                            padding: '40px 24px',
                                            textAlign: 'center',
                                            color: 'var(--fg-muted)',
                                        }}>
                                            <div style={{
                                                width: 48, height: 48,
                                                borderRadius: '50%',
                                                background: 'rgba(var(--accent-500-rgb), 0.06)',
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                margin: '0 auto 12px',
                                            }}>
                                                <Bell size={22} style={{ opacity: 0.4 }} />
                                            </div>
                                            <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-secondary)' }}>
                                                All caught up!
                                            </p>
                                            <p style={{ fontSize: 12, marginTop: 4, opacity: 0.7 }}>
                                                No new notifications
                                            </p>
                                        </div>
                                    ) : (
                                        notifications.map((notif, i) => {
                                            const color = TYPE_COLORS[notif.type] || 'var(--accent-400)';
                                            const gradient = TYPE_GRADIENTS[notif.type] || TYPE_GRADIENTS.new_expense;

                                            return (
                                                <motion.div
                                                    key={notif.id}
                                                    initial={{ opacity: 0, y: 8 }}
                                                    animate={{ opacity: 1, y: 0 }}
                                                    transition={{ delay: i * 0.04, duration: 0.2 }}
                                                    onClick={() => {
                                                        if (notif.type !== 'group_invite' || notif.read) {
                                                            handleNotificationClick(notif);
                                                        }
                                                    }}
                                                    style={{
                                                        padding: '12px 18px',
                                                        display: 'flex',
                                                        alignItems: 'flex-start',
                                                        gap: 12,
                                                        cursor: (notif.link && (notif.type !== 'group_invite' || notif.read)) ? 'pointer' : 'default',
                                                        margin: '2px 6px',
                                                        borderRadius: 12,
                                                        background: notif.read ? 'transparent' : 'rgba(var(--accent-500-rgb), 0.03)',
                                                        transition: 'background 0.15s',
                                                        position: 'relative',
                                                    }}
                                                    onMouseEnter={(e) => {
                                                        e.currentTarget.style.background = 'rgba(var(--accent-500-rgb), 0.05)';
                                                    }}
                                                    onMouseLeave={(e) => {
                                                        e.currentTarget.style.background = notif.read ? 'transparent' : 'rgba(var(--accent-500-rgb), 0.03)';
                                                    }}
                                                >
                                                    {/* ── Type Icon ── */}
                                                    <div style={{
                                                        width: 36, height: 36,
                                                        borderRadius: 10,
                                                        background: gradient,
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        color: color,
                                                        flexShrink: 0,
                                                        marginTop: 1,
                                                    }}>
                                                        {TYPE_ICONS[notif.type] || <Bell size={15} />}
                                                    </div>

                                                    {/* ── Content ── */}
                                                    <div style={{ flex: 1, minWidth: 0 }}>
                                                        <p style={{
                                                            fontSize: 13,
                                                            fontWeight: notif.read ? 500 : 600,
                                                            color: 'var(--fg-primary)',
                                                            lineHeight: 1.45,
                                                            margin: 0,
                                                            overflow: 'hidden',
                                                            textOverflow: 'ellipsis',
                                                            display: '-webkit-box',
                                                            WebkitLineClamp: 2,
                                                            WebkitBoxOrient: 'vertical',
                                                        }}>
                                                            {notif.body}
                                                        </p>
                                                        <span style={{
                                                            fontSize: 11,
                                                            color: 'var(--fg-muted)',
                                                            marginTop: 3,
                                                            display: 'block',
                                                            fontWeight: 500,
                                                        }}>
                                                            {timeAgo(notif.createdAt)}
                                                        </span>

                                                        {/* ── Accept / Decline for group invites ── */}
                                                        {notif.type === 'group_invite' && !notif.read && (
                                                            <div style={{
                                                                display: 'flex', gap: 8, marginTop: 10,
                                                            }}>
                                                                <button
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        handleInvitationAction(notif, 'accepted');
                                                                    }}
                                                                    disabled={actionLoading?.startsWith(notif.id)}
                                                                    style={{
                                                                        flex: 1, padding: '7px 14px',
                                                                        borderRadius: 8,
                                                                        background: 'linear-gradient(135deg, #10b981, #059669)',
                                                                        border: 'none', color: '#fff',
                                                                        fontSize: 12, fontWeight: 600,
                                                                        cursor: 'pointer',
                                                                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                                                                        opacity: actionLoading === `${notif.id}-accepted` ? 0.7 : 1,
                                                                        transition: 'all 0.15s',
                                                                        boxShadow: '0 2px 8px rgba(16, 185, 129, 0.25)',
                                                                    }}
                                                                >
                                                                    {actionLoading === `${notif.id}-accepted` ? (
                                                                        <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />
                                                                    ) : (
                                                                        <Check size={13} />
                                                                    )}
                                                                    Accept
                                                                </button>
                                                                <button
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        handleInvitationAction(notif, 'declined');
                                                                    }}
                                                                    disabled={actionLoading?.startsWith(notif.id)}
                                                                    style={{
                                                                        flex: 1, padding: '7px 14px',
                                                                        borderRadius: 8,
                                                                        background: 'rgba(239, 68, 68, 0.06)',
                                                                        border: '1px solid rgba(239, 68, 68, 0.12)',
                                                                        color: '#ef4444',
                                                                        fontSize: 12, fontWeight: 600,
                                                                        cursor: 'pointer',
                                                                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                                                                        opacity: actionLoading === `${notif.id}-declined` ? 0.7 : 1,
                                                                        transition: 'all 0.15s',
                                                                    }}
                                                                >
                                                                    {actionLoading === `${notif.id}-declined` ? (
                                                                        <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />
                                                                    ) : (
                                                                        <X size={13} />
                                                                    )}
                                                                    Decline
                                                                </button>
                                                            </div>
                                                        )}
                                                    </div>

                                                    {/* ── Unread indicator ── */}
                                                    {!notif.read && notif.type !== 'group_invite' && (
                                                        <div style={{
                                                            width: 7, height: 7,
                                                            borderRadius: '50%',
                                                            background: 'var(--accent-500)',
                                                            flexShrink: 0,
                                                            alignSelf: 'center',
                                                            boxShadow: '0 0 8px rgba(var(--accent-500-rgb), 0.4)',
                                                        }} />
                                                    )}
                                                </motion.div>
                                            );
                                        })
                                    )}
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </>
            )}
        </div>
    );
}
