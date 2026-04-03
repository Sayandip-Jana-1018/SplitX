'use client';

import { useEffect, useState } from 'react';

export type PerformanceMode = 'premium' | 'balanced' | 'calm';

interface PerformanceSnapshot {
    mode: PerformanceMode;
    isMobile: boolean;
    reducedMotion: boolean;
}

function resolveMode(args: {
    reducedMotion: boolean;
    isMobile: boolean;
    deviceMemory?: number;
    hardwareConcurrency?: number;
}): PerformanceMode {
    const { reducedMotion, isMobile, deviceMemory, hardwareConcurrency } = args;

    if (reducedMotion) return 'calm';

    const lowMemory = typeof deviceMemory === 'number' && deviceMemory <= 4;
    const midMemory = typeof deviceMemory === 'number' && deviceMemory <= 8;
    const lowCores = typeof hardwareConcurrency === 'number' && hardwareConcurrency <= 4;
    const midCores = typeof hardwareConcurrency === 'number' && hardwareConcurrency <= 8;

    if ((isMobile && (lowMemory || lowCores)) || (lowMemory && lowCores)) {
        return 'calm';
    }

    if (isMobile || midMemory || midCores) {
        return 'balanced';
    }

    return 'premium';
}

export function usePerformanceMode(): PerformanceSnapshot {
    const [snapshot, setSnapshot] = useState<PerformanceSnapshot>({
        mode: 'balanced',
        isMobile: false,
        reducedMotion: false,
    });

    useEffect(() => {
        if (typeof window === 'undefined') return;

        const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

        const update = () => {
            const isMobile = window.matchMedia('(max-width: 768px)').matches;
            const reducedMotion = mediaQuery.matches;
            const deviceMemory = typeof navigator !== 'undefined' && 'deviceMemory' in navigator
                ? Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory)
                : undefined;
            const hardwareConcurrency = typeof navigator !== 'undefined'
                ? navigator.hardwareConcurrency
                : undefined;

            setSnapshot({
                mode: resolveMode({
                    reducedMotion,
                    isMobile,
                    deviceMemory,
                    hardwareConcurrency,
                }),
                isMobile,
                reducedMotion,
            });
        };

        update();
        mediaQuery.addEventListener('change', update);
        window.addEventListener('resize', update);

        return () => {
            mediaQuery.removeEventListener('change', update);
            window.removeEventListener('resize', update);
        };
    }, []);

    return snapshot;
}
