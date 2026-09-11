'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Smoothly animates between numeric values (count-up on first mount,
 * then tweening from the previous value). Respects reduced motion.
 */
export function useAnimatedNumber(
    target: number,
    duration: number = 900,
    formatter?: (val: number) => string
): string {
    const [current, setCurrent] = useState(0);
    const valueRef = useRef(0);

    useEffect(() => {
        const from = valueRef.current;
        if (from === target) return;

        const reduceMotion = typeof window !== 'undefined'
            && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const total = reduceMotion ? 1 : duration;
        let frame = 0;
        let start: number | null = null;

        const tick = (timestamp: number) => {
            if (start === null) start = timestamp;
            const progress = Math.min((timestamp - start) / total, 1);
            const eased = 1 - Math.pow(1 - progress, 4);
            const next = Math.round(from + (target - from) * eased);
            valueRef.current = next;
            setCurrent(next);
            if (progress < 1) frame = requestAnimationFrame(tick);
        };

        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, [target, duration]);

    return formatter ? formatter(current) : current.toString();
}
