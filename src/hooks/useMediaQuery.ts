'use client';

import { useCallback, useSyncExternalStore } from 'react';

/** Subscribe to a CSS media query. Returns `serverFallback` during SSR. */
export function useMediaQuery(query: string, serverFallback = false): boolean {
    const subscribe = useCallback(
        (onChange: () => void) => {
            const media = window.matchMedia(query);
            media.addEventListener('change', onChange);
            return () => media.removeEventListener('change', onChange);
        },
        [query]
    );

    return useSyncExternalStore(
        subscribe,
        () => window.matchMedia(query).matches,
        () => serverFallback
    );
}

const subscribeNoop = () => () => undefined;

/** True once running in the browser (after hydration). */
export function useIsClient(): boolean {
    return useSyncExternalStore(subscribeNoop, () => true, () => false);
}
