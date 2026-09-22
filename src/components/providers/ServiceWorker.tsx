'use client';

import { useEffect } from 'react';

/**
 * Registers public/sw.js in production. `updateViaCache: 'none'` makes the
 * browser check the worker itself on every visit, so a fix to it reaches
 * installed apps on their next launch.
 */
export default function ServiceWorker() {
    useEffect(() => {
        if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
        navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => {
            // Without a worker the app still works; it just can't be installed.
        });
    }, []);
    return null;
}
