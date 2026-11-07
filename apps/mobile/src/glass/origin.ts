/**
 * Where a piece of glass is on screen, so it can draw the liquid that is behind it. It is measured
 * when it lays out and when its screen comes into focus; scrolling is followed on the UI thread,
 * so nothing is measured while a list moves.
 */
import { useFocusEffect } from 'expo-router';
import { createContext, useCallback, useContext, useRef, type ComponentRef } from 'react';
import type { View } from 'react-native';
import { useDerivedValue, useSharedValue, type SharedValue } from 'react-native-reanimated';

export interface ScrollOffsets {
    x?: SharedValue<number>;
    y?: SharedValue<number>;
}

export const ScrollContext = createContext<ScrollOffsets>({});

/** Long enough for a screen's entering transition to finish before measuring again. */
const SETTLE_MS = 450;

export function useScreenOrigin() {
    const ref = useRef<ComponentRef<typeof View>>(null);
    const scroll = useContext(ScrollContext);
    const baseX = useSharedValue(0);
    const baseY = useSharedValue(-10_000);
    const measure = useCallback(() => {
        ref.current?.measureInWindow((x, y) => {
            baseX.value = x + (scroll.x?.value ?? 0);
            baseY.value = y + (scroll.y?.value ?? 0);
        });
    }, [scroll, baseX, baseY]);

    useFocusEffect(
        useCallback(() => {
            const timer = setTimeout(measure, SETTLE_MS);
            return () => clearTimeout(timer);
        }, [measure]),
    );

    const scrollX = scroll.x;
    const scrollY = scroll.y;
    const origin = useDerivedValue(() => [baseX.value - (scrollX ? scrollX.value : 0), baseY.value - (scrollY ? scrollY.value : 0)]);
    return { ref, measure, origin };
}
