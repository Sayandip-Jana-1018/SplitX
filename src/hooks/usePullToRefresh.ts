'use client';

import { useState, useRef, useCallback, useEffect } from 'react';

interface PullToRefreshOptions {
    onRefresh: () => Promise<void>;
    threshold?: number; // px to pull before triggering
    disabled?: boolean;
    activationHeight?: number;
}

export function usePullToRefresh({
    onRefresh,
    threshold = 80,
    disabled = false,
    activationHeight = 120,
}: PullToRefreshOptions) {
    const [pulling, setPulling] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [pullDistance, setPullDistance] = useState(0);
    const startY = useRef(0);
    const containerRef = useRef<HTMLDivElement>(null);
    const canPullRef = useRef(false);

    const handleTouchStart = useCallback((e: TouchEvent) => {
        if (disabled || refreshing) return;
        const el = containerRef.current;
        if (!el || el.scrollTop > 0) return;
        const touchY = e.touches[0].clientY - el.getBoundingClientRect().top;
        if (touchY > activationHeight) {
            canPullRef.current = false;
            return;
        }
        startY.current = e.touches[0].clientY;
        canPullRef.current = true;
    }, [activationHeight, disabled, refreshing]);

    const handleTouchMove = useCallback((e: TouchEvent) => {
        if (!canPullRef.current || disabled || refreshing) return;
        const el = containerRef.current;
        if (!el || el.scrollTop > 0) {
            canPullRef.current = false;
            setPulling(false);
            setPullDistance(0);
            return;
        }
        const dy = e.touches[0].clientY - startY.current;
        if (dy > 0) {
            if (!pulling) {
                setPulling(true);
            }
            setPullDistance(Math.min(dy * 0.5, threshold * 1.5));
            if (dy > 10) {
                if (e.cancelable) e.preventDefault();
            }
        } else {
            canPullRef.current = false;
            setPulling(false);
            setPullDistance(0);
        }
    }, [pulling, disabled, refreshing, threshold]);

    const handleTouchEnd = useCallback(async () => {
        canPullRef.current = false;
        if (!pulling) return;
        setPulling(false);
        if (pullDistance >= threshold && !refreshing) {
            setRefreshing(true);
            setPullDistance(threshold * 0.6);
            try {
                await onRefresh();
            } catch (err) {
                console.error('Pull-to-refresh error:', err);
            } finally {
                setRefreshing(false);
                setPullDistance(0);
            }
        } else {
            setPullDistance(0);
        }
    }, [pulling, pullDistance, threshold, refreshing, onRefresh]);

    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        el.addEventListener('touchstart', handleTouchStart, { passive: true });
        el.addEventListener('touchmove', handleTouchMove, { passive: false });
        el.addEventListener('touchend', handleTouchEnd);
        return () => {
            el.removeEventListener('touchstart', handleTouchStart);
            el.removeEventListener('touchmove', handleTouchMove);
            el.removeEventListener('touchend', handleTouchEnd);
        };
    }, [handleTouchStart, handleTouchMove, handleTouchEnd]);

    return {
        containerRef,
        pullDistance,
        refreshing,
        isPulling: pulling && pullDistance > 0,
    };
}
