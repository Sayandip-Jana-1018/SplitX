/**
 * One clock for all the glass, so the wall and every surface show the same moment of the liquid.
 * In calm motion the clock stops, and with it every redraw.
 *
 * The clock is paced by the website's own governor (src/lib/glass/governor.ts): the UI thread
 * times each frame it draws, hands the governor forty at a time, and the governor picks how often
 * the liquid moves on. Only the liquid's clock is paced; the glass still follows a scroll at the
 * screen's own rate. A slow phone's liquid moves less often, but it never stops on its own.
 * While a touch's ring or a new colour spreads, the liquid runs at full pace whatever the level, as
 * on the website.
 *
 * The liquid's state at each moment (where its masses are, where the light is) is worked out once
 * per frame here, and every pane of glass reads it, instead of each pane working it out again.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useWindowDimensions, View, type StyleProp, type ViewStyle } from 'react-native';
import { useDerivedValue, useFrameCallback, useSharedValue, type DerivedValue, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { frameIsDue, Governor, nextFrameDue, type PacedLevel } from '@shared/glass/governor';
import { useLook } from '~/theme/ThemeProvider';
import { webDeps } from './deps';
import { liquidUniforms, RIPPLE_S, TOUCH_S } from './uniforms';

/** The phone's levels, best first: the liquid moves on 60, 40, 30 or 20 times a second. */
export const PACE: readonly (PacedLevel & { fps: number })[] = [
    { frameMs: 16.7, fps: 60 },
    { frameMs: 25, fps: 40 },
    { frameMs: 33.4, fps: 30 },
    { frameMs: 50, fps: 20 },
];

/** While a ripple plays: every frame the screen offers, up to 120 a second. */
const RIPPLE_FRAME_MS = 1000 / 120;

/** Frames the governor judges at once, as on the website. */
const WINDOW = 40;
const LEVEL_KEY = 'splitit.glass.pace';

interface Glass {
    /** Seconds, as the shaders count them. */
    time: SharedValue<number>;
    /** The last touch: [x, y, when on the clock], `when` below zero for none. */
    touch: SharedValue<number[]>;
    /** The liquid's uniforms at this moment, shared by the wall, every pane of glass and every coin. */
    liquid: DerivedValue<ReturnType<typeof liquidUniforms>>;
    /** Starts a ring in the liquid where a finger came down. */
    ripple: (x: number, y: number) => void;
    width: number;
    height: number;
    /** How many times a second the liquid moves on now. */
    fps: number;
}

const GlassContext = createContext<Glass | null>(null);

/** Each launch starts somewhere new in the liquid's slow drift, like the website. */
const START = (Date.now() % 600_000) / 1000;

export function GlassProvider({ children }: { children: ReactNode }) {
    const { calm, pal } = useLook();
    const { width, height } = useWindowDimensions();
    const time = useSharedValue(START);
    const touch = useSharedValue<number[]>([0, 0, -1]);
    const before = useSharedValue(pal);
    const rip = useSharedValue<number[]>([0, 0, -1]);
    const liquid = useDerivedValue(() => liquidUniforms(time.value, width, height, pal, touch.value, before.value, rip.value), webDeps([pal, width, height]));

    // A new colour or mode spreads from where it was chosen: the last touch, if it was just now.
    const shown = useRef(pal);
    useEffect(() => {
        if (shown.current === pal) return;
        const old = shown.current;
        shown.current = pal;
        if (calm) return;
        const [x, y, at] = touch.value;
        const now = time.value;
        const fresh = at >= 0 && now - at < 1.5;
        before.set(old);
        rip.set([fresh ? x : width / 2, fresh ? y : height / 2, now]);
    }, [pal, calm, touch, time, before, rip, width, height]);
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
        const rippling = (touch.value[2] >= 0 && time.value - touch.value[2] < TOUCH_S) || (rip.value[2] >= 0 && time.value - rip.value[2] < RIPPLE_S);
        // A ripple plays at the screen's own rate (120 a second on a fast phone), so it glides.
        const pace = rippling ? RIPPLE_FRAME_MS : frameMs.value;
        if (!frameIsDue(now, due.value)) return;
        due.set(nextFrameDue(now, due.value, pace));
        if (last.value > 0) {
            const took = now - last.value;
            samples.modify((list) => {
                'worklet';
                list.push(took);
                return list;
            }, false);
            if (samples.value.length >= WINDOW) {
                const batch = samples.value.slice();
                samples.set([]);
                scheduleOnRN(judge, batch);
            }
        }
        last.set(now);
        time.set(START + frame.timeSinceFirstFrame / 1000);
    }, false);

    useEffect(() => {
        clock.setActive(!calm);
    }, [calm, clock]);

    const ripple = useCallback(
        (x: number, y: number) => {
            if (!calm) touch.set([x, y, time.value]);
        },
        [calm, touch, time],
    );

    const value = useMemo(() => ({ time, touch, liquid, ripple, width, height, fps: PACE[level].fps }), [time, touch, liquid, ripple, width, height, level]);
    return <GlassContext.Provider value={value}>{children}</GlassContext.Provider>;
}

/**
 * Hears every touch anywhere in the app without taking it from the control underneath (touch
 * events bubble up to here), and starts a ring in the liquid where the finger came down.
 */
export function TouchRipples({ style, children }: { style?: StyleProp<ViewStyle>; children: ReactNode }) {
    const { ripple } = useGlass();
    return (
        <View style={style} onTouchStart={(event) => ripple(event.nativeEvent.pageX, event.nativeEvent.pageY)}>
            {children}
        </View>
    );
}

export function useGlass(): Glass {
    const glass = useContext(GlassContext);
    if (!glass) throw new Error('useGlass needs GlassProvider above it');
    return glass;
}
