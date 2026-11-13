/**
 * Where a piece of glass is on screen, so it can draw the liquid that is behind it. It is measured
 * when it lays out and when its screen comes into focus; scrolling is followed on the UI thread,
 * so nothing is measured while a list moves.
 */
import { useFocusEffect } from 'expo-router';
import { createContext, useCallback, useContext, useMemo, useRef, type ComponentRef } from 'react';
import type { View } from 'react-native';
import { useDerivedValue, useSharedValue, type SharedValue } from 'react-native-reanimated';

export interface ScrollOffsets {
    x?: SharedValue<number>;
    y?: SharedValue<number>;
}

export const ScrollContext = createContext<ScrollOffsets>({});

/** A measured spot: its window position is (baseX - scrollX, baseY - scrollY). */
export interface Place {
    baseX: SharedValue<number>;
    baseY: SharedValue<number>;
    scrollX?: SharedValue<number>;
    scrollY?: SharedValue<number>;
}

/** Long enough for a screen's entering transition to finish before measuring again. */
const SETTLE_MS = 450;

/**
 * The spot only, with no work done per frame: a glass layer reads it while it draws. Until it is
 * measured it sits far above the screen.
 */
export function useScreenPlace() {
    const ref = useRef<ComponentRef<typeof View>>(null);
    const scroll = useContext(ScrollContext);
    const baseX = useSharedValue(0);
    const baseY = useSharedValue(-10_000);
    const measure = useCallback(() => {
        ref.current?.measureInWindow((x, y) => {
            baseX.set(x + (scroll.x?.value ?? 0));
            baseY.set(y + (scroll.y?.value ?? 0));
        });
    }, [scroll, baseX, baseY]);

    useFocusEffect(
        useCallback(() => {
            const timer = setTimeout(measure, SETTLE_MS);
            return () => clearTimeout(timer);
        }, [measure]),
    );

    const place = useMemo<Place>(() => ({ baseX, baseY, scrollX: scroll.x, scrollY: scroll.y }), [baseX, baseY, scroll]);
    return { ref, measure, place };
}

/** The spot as a value that follows scrolling on its own: for glass that draws its own canvas. */
export function useScreenOrigin() {
    const { ref, measure, place } = useScreenPlace();
    const { baseX, baseY, scrollX, scrollY } = place;
    const origin = useDerivedValue(() => [baseX.value - (scrollX ? scrollX.value : 0), baseY.value - (scrollY ? scrollY.value : 0)]);
    return { ref, measure, origin };
}
