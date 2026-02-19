'use client';

import { useEffect } from 'react';

const PING_INTERVAL = 4 * 60 * 1000; // 4 minutes

/**
 * Invisible component that pings /api/health every 4 minutes
 * to keep the Neon DB compute from auto-suspending.
 * Only runs client-side while the app is open in the browser.
 */
export default function DbKeepAlive() {
    useEffect(() => {
        const ping = () => {
            fetch('/api/health').catch(() => {
                // Silently ignore — network may be down
            });
        };

        // Initial ping on mount
        ping();

        const interval = setInterval(ping, PING_INTERVAL);
        return () => clearInterval(interval);
    }, []);

    return null; // Renders nothing
}
