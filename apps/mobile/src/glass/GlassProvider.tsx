/**
 * One clock for all the glass, so the wall and every surface show the same moment of the liquid.
 * In calm motion the clock stops, and with it every redraw.
 */
import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useWindowDimensions } from 'react-native';
import { useFrameCallback, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { useLook } from '~/theme/ThemeProvider';

interface Glass {
    /** Seconds, as the shaders count them. */
    time: SharedValue<number>;
    width: number;
    height: number;
}

const GlassContext = createContext<Glass | null>(null);

/** Each launch starts somewhere new in the liquid's slow drift, like the website. */
const START = (Date.now() % 600_000) / 1000;

export function GlassProvider({ children }: { children: ReactNode }) {
    const { calm } = useLook();
    const { width, height } = useWindowDimensions();
    const time = useSharedValue(START);
    const clock = useFrameCallback((frame) => {
        time.value = START + frame.timeSinceFirstFrame / 1000;
    }, false);

    useEffect(() => {
        clock.setActive(!calm);
    }, [calm, clock]);

    return <GlassContext.Provider value={{ time, width, height }}>{children}</GlassContext.Provider>;
}

export function useGlass(): Glass {
    const glass = useContext(GlassContext);
    if (!glass) throw new Error('useGlass needs GlassProvider above it');
    return glass;
}
