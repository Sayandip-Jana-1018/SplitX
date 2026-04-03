'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { WifiOff, Wifi } from 'lucide-react';
import { onRestrictedNetworkSignal } from '@/lib/networkErrors';

export default function OfflineIndicator() {
    const [isOnline, setIsOnline] = useState(true);
    const [showReconnected, setShowReconnected] = useState(false);
    const [showRestricted, setShowRestricted] = useState(false);

    useEffect(() => {
        let restrictedTimer: number | null = null;
        const handleOnline = () => {
            setIsOnline(true);
            setShowReconnected(true);
            setTimeout(() => setShowReconnected(false), 2500);
        };
        const handleOffline = () => {
            setIsOnline(false);
            setShowReconnected(false);
        };

        // Check initial state
        const t = setTimeout(() => setIsOnline(navigator.onLine), 0);
        const cleanupRestricted = onRestrictedNetworkSignal(() => {
            if (!navigator.onLine) return;
            setShowRestricted(true);
            if (restrictedTimer) window.clearTimeout(restrictedTimer);
            restrictedTimer = window.setTimeout(() => setShowRestricted(false), 4200);
        });

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        return () => {
            clearTimeout(t);
            if (restrictedTimer) window.clearTimeout(restrictedTimer);
            cleanupRestricted();
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, []);

    return (
        <AnimatePresence>
            {!isOnline && (
                <motion.div
                    initial={{ y: -50, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: -50, opacity: 0 }}
                    transition={{ type: 'spring', damping: 20, stiffness: 300 }}
                    style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        right: 0,
                        zIndex: 10000,
                        background: 'linear-gradient(135deg, #ef4444, #dc2626)',
                        color: 'white',
                        padding: '8px 16px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 8,
                        fontSize: '13px',
                        fontWeight: 600,
                        backdropFilter: 'blur(10px)',
                    }}
                >
                    <motion.div
                        animate={{ rotate: [0, -10, 10, -10, 0] }}
                        transition={{ duration: 0.5, repeat: Infinity, repeatDelay: 2 }}
                    >
                        <WifiOff size={16} />
                    </motion.div>
                    You&apos;re offline — changes will sync when reconnected
                </motion.div>
            )}
            {showReconnected && isOnline && (
                <motion.div
                    initial={{ y: -50, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: -50, opacity: 0 }}
                    transition={{ type: 'spring', damping: 20, stiffness: 300 }}
                    style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        right: 0,
                        zIndex: 10000,
                        background: 'linear-gradient(135deg, #10b981, #059669)',
                        color: 'white',
                        padding: '8px 16px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 8,
                        fontSize: '13px',
                        fontWeight: 600,
                    }}
                >
                    <Wifi size={16} />
                    Back online!
                </motion.div>
            )}
            {showRestricted && isOnline && (
                <motion.div
                    initial={{ y: -50, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: -50, opacity: 0 }}
                    transition={{ type: 'spring', damping: 20, stiffness: 300 }}
                    style={{
                        position: 'fixed',
                        top: showReconnected ? 42 : 0,
                        left: 0,
                        right: 0,
                        zIndex: 9999,
                        background: 'linear-gradient(135deg, #f59e0b, #d97706)',
                        color: 'white',
                        padding: '8px 16px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 8,
                        fontSize: '13px',
                        fontWeight: 600,
                    }}
                >
                    <WifiOff size={16} />
                    This network may be blocking SplitX. Try another network and try again.
                </motion.div>
            )}
        </AnimatePresence>
    );
}
