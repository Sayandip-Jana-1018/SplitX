'use client';

import { useEffect } from 'react';
import { useSession } from 'next-auth/react';

const PING_INTERVAL = 4 * 60 * 1000; // 4 minutes

/**
 * Invisible component that pings /api/health every 4 minutes
 * to keep the Neon DB compute from auto-suspending.
 * Only runs client-side while the app is open and user is authenticated.
 */
export default function DbKeepAlive() {
    const { status } = useSession();

    useEffect(() => {
        if (status !== 'authenticated') return;

        const ping = () => {
            fetch('/api/health').catch(() => {
                // Silently ignore — network may be down
            });
        };

        const idleCallback = window.requestIdleCallback?.(() => ping(), { timeout: 2500 });
        const initialTimer = window.setTimeout(() => ping(), 1200);

        const interval = setInterval(ping, PING_INTERVAL);
        return () => {
            if (idleCallback) window.cancelIdleCallback?.(idleCallback);
            clearTimeout(initialTimer);
            clearInterval(interval);
        };
    }, [status]);

    return null; // Renders nothing
}
