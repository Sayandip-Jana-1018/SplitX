'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { WifiOff, Wifi, ShieldAlert } from 'lucide-react';
import { onRestrictedNetworkSignal } from '@/lib/networkErrors';

type StatusTone = 'offline' | 'online' | 'restricted';

const TONE_STYLES: Record<StatusTone, { bg: string; fg: string }> = {
    offline: { bg: 'var(--fg-primary)', fg: 'var(--fg-inverse)' },
    online: { bg: 'linear-gradient(135deg, #10b981, #059669)', fg: '#fff' },
    restricted: { bg: 'linear-gradient(135deg, #f59e0b, #d97706)', fg: '#fff' },
};

function StatusPill({ tone, icon, children }: { tone: StatusTone; icon: React.ReactNode; children: React.ReactNode }) {
    const style = TONE_STYLES[tone];
    return (
        <motion.div
            role="status"
            initial={{ y: -40, opacity: 0, scale: 0.96 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: -30, opacity: 0, scale: 0.96 }}
            transition={{ type: 'spring', damping: 24, stiffness: 360 }}
            style={{
                position: 'fixed',
                top: 'calc(env(safe-area-inset-top, 0px) + 10px)',
                left: '50%',
                x: '-50%',
                zIndex: 10000,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                maxWidth: 'calc(100vw - 24px)',
                padding: '10px 16px',
                borderRadius: 999,
                background: style.bg,
                color: style.fg,
                fontSize: 13,
                fontWeight: 600,
                boxShadow: 'var(--shadow-lg)',
                whiteSpace: 'nowrap',
            }}
        >
            {icon}
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{children}</span>
        </motion.div>
    );
}

export default function OfflineIndicator() {
    const [isOnline, setIsOnline] = useState(true);
    const [showReconnected, setShowReconnected] = useState(false);
    const [showRestricted, setShowRestricted] = useState(false);

    useEffect(() => {
        let restrictedTimer: number | null = null;
        let reconnectTimer: number | null = null;
        const handleOnline = () => {
            setIsOnline(true);
            setShowReconnected(true);
            reconnectTimer = window.setTimeout(() => setShowReconnected(false), 2500);
        };
        const handleOffline = () => {
            setIsOnline(false);
            setShowReconnected(false);
        };

        const initial = window.setTimeout(() => setIsOnline(navigator.onLine), 0);
        const cleanupRestricted = onRestrictedNetworkSignal(() => {
            if (!navigator.onLine) return;
            setShowRestricted(true);
            if (restrictedTimer) window.clearTimeout(restrictedTimer);
            restrictedTimer = window.setTimeout(() => setShowRestricted(false), 4200);
        });

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        return () => {
            window.clearTimeout(initial);
            if (restrictedTimer) window.clearTimeout(restrictedTimer);
            if (reconnectTimer) window.clearTimeout(reconnectTimer);
            cleanupRestricted();
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, []);

    return (
        <AnimatePresence>
            {!isOnline && (
                <StatusPill key="offline" tone="offline" icon={<WifiOff size={15} />}>
                    You&apos;re offline — changes sync when you reconnect
                </StatusPill>
            )}
            {isOnline && showReconnected && (
                <StatusPill key="online" tone="online" icon={<Wifi size={15} />}>
                    Back online
                </StatusPill>
            )}
            {isOnline && !showReconnected && showRestricted && (
                <StatusPill key="restricted" tone="restricted" icon={<ShieldAlert size={15} />}>
                    This network may be blocking SplitX
                </StatusPill>
            )}
        </AnimatePresence>
    );
}
