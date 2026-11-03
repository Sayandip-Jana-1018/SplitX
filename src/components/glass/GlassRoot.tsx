'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import type { GlassEngine } from '@/lib/glass/engine';
import { setGlassEngine } from '@/lib/glass/runtime';

/**
 * Starts the one glass engine, once the page is usable: it is a download of its own,
 * and until it arrives glass.css draws everything. Paper gets none of it.
 */
export function GlassRoot() {
    const onPaper = usePathname().endsWith('/journey/print');

    useEffect(() => {
        if (onPaper) return;
        let engine: GlassEngine | null = null;
        let gone = false;
        const start = () => {
            import('@/lib/glass/engine')
                .then(({ createGlassEngine }) => {
                    if (gone) return;
                    engine = createGlassEngine();
                    setGlassEngine(engine);
                })
                // A failed download costs some beauty and nothing else.
                .catch(() => undefined);
        };
        const idle = window.requestIdleCallback?.(start, { timeout: 1200 });
        const timer = idle === undefined ? window.setTimeout(start, 400) : 0;
        return () => {
            gone = true;
            if (idle !== undefined) window.cancelIdleCallback?.(idle);
            window.clearTimeout(timer);
            engine?.destroy();
            setGlassEngine(null);
        };
    }, [onPaper]);

    return null;
}
