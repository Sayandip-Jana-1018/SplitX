'use client';

import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell, BellRing, Check, CheckCheck, X, Receipt, Users, ArrowRightLeft, Clock, Send, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { IconButton } from '@/components/ui/kit';
import { useIsClient } from '@/hooks/useMediaQuery';
import { cn, timeAgo } from '@/lib/utils';
import styles from './notifications.module.css';

interface Notification {
    id: string;
    type: string;
    title: string;
    body: string;
    read: boolean;
    link?: string;
    createdAt: string;
    actor?: { name: string | null; image: string | null };
}

type Tone = 'accent' | 'warning' | 'success' | 'danger' | 'info';

const TYPE_META: Record<string, { icon: React.ReactNode; tone: Tone }> = {
    new_expense: { icon: <Receipt size={17} />, tone: 'accent' },
    payment_reminder: { icon: <Clock size={17} />, tone: 'warning' },
    settlement_approval_request: { icon: <CheckCheck size={17} />, tone: 'info' },
    settlement_completed: { icon: <ArrowRightLeft size={17} />, tone: 'success' },
    settlement_rejected: { icon: <X size={17} />, tone: 'danger' },
    group_activity: { icon: <Users size={17} />, tone: 'info' },
    group_invite: { icon: <Send size={17} />, tone: 'accent' },
    group_invite_accepted: { icon: <CheckCheck size={17} />, tone: 'success' },
    member_joined: { icon: <Users size={17} />, tone: 'info' },
};

export default function NotificationPanel() {
    const [open, setOpen] = useState(false);
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const mounted = useIsClient();
    const router = useRouter();

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

    // ── Invitation accept/decline ──
    const handleInvitationAction = async (notif: Notification, status: 'accepted' | 'declined') => {
        if (!notif.link) return;
        const match = notif.link.match(/\/invitations\/([^/?#]+)/);
        const invitationId = match?.[1];
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

            setNotifications(prev => prev.map(n => n.id === notif.id ? { ...n, read: true } : n));
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

    useEffect(() => {
        if (!mounted) return;
        fetchNotifications();
        const interval = setInterval(fetchNotifications, 30_000);
        return () => clearInterval(interval);
    }, [mounted, fetchNotifications]);

    useEffect(() => {
        if (!open) return;
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setOpen(false);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
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
                setNotifications(prev => prev.map(n => n.id === notif.id ? { ...n, read: true } : n));
                setUnreadCount(prev => Math.max(0, prev - 1));
            } catch { /* silent */ }
        }

        if (notif.type === 'group_invite') {
            return;
        }

        if (notif.link) {
            setOpen(false);
            router.push(notif.link);
        }
    };

    const openPanel = () => {
        setOpen(true);
        fetchNotifications();
    };

    if (!isFeatureEnabled('notifications')) return null;

    const unread = notifications.filter((n) => !n.read);
    const earlier = notifications.filter((n) => n.read);

    const renderItem = (notif: Notification, index: number) => {
        const meta = TYPE_META[notif.type] || { icon: <Bell size={17} />, tone: 'accent' as Tone };
        const isPendingInvite = notif.type === 'group_invite' && !notif.read;
        const clickable = Boolean(notif.link) && !isPendingInvite;
        return (
            <motion.div
                key={notif.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(index * 0.03, 0.24), duration: 0.2 }}
                className={cn(styles.item, !notif.read && styles.itemUnread, clickable && styles.itemClickable)}
                onClick={() => {
                    if (!isPendingInvite) handleNotificationClick(notif);
                }}
                role={clickable ? 'button' : undefined}
                tabIndex={clickable ? 0 : undefined}
                onKeyDown={(event) => {
                    if (clickable && (event.key === 'Enter' || event.key === ' ')) {
                        event.preventDefault();
                        handleNotificationClick(notif);
                    }
                }}
            >
                <span className={cn(styles.itemIcon, !notif.actor?.image && styles[`tone_${meta.tone}`])}>
                    {notif.actor?.image ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img src={notif.actor.image} alt={notif.actor.name || 'User'} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : meta.icon}
                </span>
                <div className={styles.itemBody}>
                    <p className={styles.itemText}>{notif.body}</p>
                    <span className={styles.itemTime}>{timeAgo(notif.createdAt)}</span>
                    {isPendingInvite && (
                        <div className={styles.inviteActions}>
                            <button
                                type="button"
                                className={styles.accept}
                                disabled={actionLoading?.startsWith(notif.id)}
                                onClick={(event) => {
                                    event.stopPropagation();
                                    handleInvitationAction(notif, 'accepted');
                                }}
                            >
                                {actionLoading === `${notif.id}-accepted` ? <Loader2 size={14} className="spin" /> : <Check size={14} />}
                                Accept
                            </button>
                            <button
                                type="button"
                                className={styles.decline}
                                disabled={actionLoading?.startsWith(notif.id)}
                                onClick={(event) => {
                                    event.stopPropagation();
                                    handleInvitationAction(notif, 'declined');
                                }}
                            >
                                {actionLoading === `${notif.id}-declined` ? <Loader2 size={14} className="spin" /> : <X size={14} />}
                                Decline
                            </button>
                        </div>
                    )}
                </div>
                {!notif.read && !isPendingInvite && <span className={styles.unreadDot} aria-label="Unread" />}
            </motion.div>
        );
    };

    return (
        <>
            <IconButton
                icon={(
                    <motion.span
                        style={{ display: 'grid', placeItems: 'center', transformOrigin: '50% 15%' }}
                        animate={{ rotate: [0, -14, 12, -9, 6, -3, 0] }}
                        transition={{ duration: 1.2, repeat: Infinity, repeatDelay: unreadCount > 0 ? 2.6 : 6, ease: 'easeInOut' }}
                    >
                        {unreadCount > 0 ? <BellRing size={18} /> : <Bell size={18} />}
                    </motion.span>
                )}
                label="Notifications"
                badge={unreadCount > 0 ? unreadCount : undefined}
                onClick={openPanel}
            />

            {mounted && createPortal(
                <AnimatePresence>
                    {open && (
                        <motion.div
                            key="notifications-overlay"
                            className={styles.overlay}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.18 }}
                            onClick={() => setOpen(false)}
                        >
                            <motion.section
                                role="dialog"
                                aria-modal="true"
                                aria-label="Notifications"
                                className={styles.panel}
                                initial={{ opacity: 0, y: -12, scale: 0.97 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                exit={{ opacity: 0, y: -8, scale: 0.98 }}
                                transition={{ type: 'spring', damping: 32, stiffness: 440 }}
                                onClick={(event) => event.stopPropagation()}
                            >
                                <header className={styles.header}>
                                    <div className={styles.headerTitle}>
                                        <h2>Notifications</h2>
                                        {unreadCount > 0 && <span className={styles.count}>{unreadCount}</span>}
                                    </div>
                                    <div className={styles.headerActions}>
                                        {unreadCount > 0 && (
                                            <button type="button" className={styles.markAll} onClick={markAllRead}>
                                                <CheckCheck size={14} />
                                                Mark all read
                                            </button>
                                        )}
                                        <button type="button" className={styles.close} onClick={() => setOpen(false)} aria-label="Close notifications">
                                            <X size={16} />
                                        </button>
                                    </div>
                                </header>

                                <div className={styles.list}>
                                    {notifications.length === 0 ? (
                                        <div className={styles.empty}>
                                            <span className={styles.emptyIcon}><Bell size={24} /></span>
                                            <p className={styles.emptyTitle}>You&apos;re all caught up</p>
                                            <p className={styles.emptyText}>Reminders, approvals and invites will show up here.</p>
                                        </div>
                                    ) : (
                                        <>
                                            {unread.length > 0 && <div className={styles.groupLabel}>New</div>}
                                            {unread.map((notif, index) => renderItem(notif, index))}
                                            {earlier.length > 0 && <div className={styles.groupLabel}>Earlier</div>}
                                            {earlier.map((notif, index) => renderItem(notif, unread.length + index))}
                                        </>
                                    )}
                                </div>
                            </motion.section>
                        </motion.div>
                    )}
                </AnimatePresence>,
                document.body
            )}
        </>
    );
}
