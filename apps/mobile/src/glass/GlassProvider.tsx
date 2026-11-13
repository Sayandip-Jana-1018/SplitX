/**
 * One clock for all the glass, so the wall and every surface show the same moment of the liquid.
 * In calm motion the clock stops, and with it every redraw.
 *
 * The clock is paced by the website's own governor (src/lib/glass/governor.ts): the UI thread
 * times each frame it draws, hands the governor forty at a time, and the governor picks how often
 * the liquid moves on. Only the liquid's clock is paced; the glass still follows a scroll at the
 * screen's own rate. A slow phone's liquid moves less often, but it never stops on its own.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useWindowDimensions } from 'react-native';
import { useFrameCallback, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { frameIsDue, Governor, nextFrameDue, type PacedLevel } from '@shared/glass/governor';
import { useLook } from '~/theme/ThemeProvider';

/** The phone's levels, best first: the liquid moves on 60, 40, 30 or 20 times a second. */
export const PACE: readonly (PacedLevel & { fps: number })[] = [
    { frameMs: 16.7, fps: 60 },
    { frameMs: 25, fps: 40 },
    { frameMs: 33.4, fps: 30 },
    { frameMs: 50, fps: 20 },
];

/** Frames the governor judges at once, as on the website. */
const WINDOW = 40;
const LEVEL_KEY = 'splitit.glass.pace';

interface Glass {
    /** Seconds, as the shaders count them. */
    time: SharedValue<number>;
    width: number;
    height: number;
    /** How many times a second the liquid moves on now. */
    fps: number;
}

const GlassContext = createContext<Glass | null>(null);

/** Each launch starts somewhere new in the liquid's slow drift, like the website. */
const START = (Date.now() % 600_000) / 1000;

export function GlassProvider({ children }: { children: ReactNode }) {
    const { calm } = useLook();
    const { width, height } = useWindowDimensions();
    const time = useSharedValue(START);
    const frameMs = useSharedValue(PACE[0].frameMs);
    const due = useSharedValue(0);
    const last = useSharedValue(0);
    const samples = useSharedValue<number[]>([]);
    const governor = useRef(new Governor(0, PACE));
    const [level, setLevel] = useState(0);

    const apply = useCallback(
        (next: number) => {
            frameMs.set(PACE[next].frameMs);
            setLevel(next);
        },
        [frameMs],
    );

    // Where this phone settled last time, so a slow phone doesn't stutter for a few seconds first.
    useEffect(() => {
        AsyncStorage.getItem(LEVEL_KEY)
            .then((saved) => {
                const start = Number(saved);
                if (!saved || !Number.isInteger(start)) return;
                governor.current = new Governor(start, PACE);
                apply(governor.current.level);
            })
            .catch(() => undefined);
    }, [apply]);

    /** Forty frame lengths from the UI thread. 'calm' is ignored: the liquid keeps floating at its slowest. */
    const judge = useCallback(
        (batch: number[]) => {
            const before = governor.current.level;
            for (const ms of batch) governor.current.sample(ms);
            const after = governor.current.level;
            if (after === before) return;
            apply(after);
            AsyncStorage.setItem(LEVEL_KEY, String(after)).catch(() => undefined);
        },
        [apply],
    );

    const clock = useFrameCallback((frame) => {
        'worklet';
        const now = frame.timestamp;
        if (!frameIsDue(now, due.value)) return;
        due.value = nextFrameDue(now, due.value, frameMs.value);
        if (last.value > 0) {
            const took = now - last.value;
            samples.modify((list) => {
                'worklet';
                list.push(took);
                return list;
            }, false);
            if (samples.value.length >= WINDOW) {
                const batch = samples.value.slice();
                samples.value = [];
                scheduleOnRN(judge, batch);
            }
        }
        last.value = now;
        time.value = START + frame.timeSinceFirstFrame / 1000;
    }, false);

    useEffect(() => {
        clock.setActive(!calm);
    }, [calm, clock]);

    const value = useMemo(() => ({ time, width, height, fps: PACE[level].fps }), [time, width, height, level]);
    return <GlassContext.Provider value={value}>{children}</GlassContext.Provider>;
}

export function useGlass(): Glass {
    const glass = useContext(GlassContext);
    if (!glass) throw new Error('useGlass needs GlassProvider above it');
    return glass;
}
