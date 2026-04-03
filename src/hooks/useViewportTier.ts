'use client';

import { useEffect, useState } from 'react';

export type ViewportTier = 'mobile' | 'tablet' | 'desktop';

export function useViewportTier() {
    const [tier, setTier] = useState<ViewportTier>('mobile');

    useEffect(() => {
        if (typeof window === 'undefined') return;

        const update = () => {
            const width = window.innerWidth;
            if (width >= 1280) setTier('desktop');
            else if (width >= 768) setTier('tablet');
            else setTier('mobile');
        };

        update();
        window.addEventListener('resize', update);
        return () => window.removeEventListener('resize', update);
    }, []);

    return {
        tier,
        isMobile: tier === 'mobile',
        isTablet: tier === 'tablet',
        isDesktop: tier === 'desktop',
        isWide: tier !== 'mobile',
    };
}
