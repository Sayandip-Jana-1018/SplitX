/**
 * A glass layer: one canvas that draws every pane of glass and every coin inside it, as the
 * website's one WebGL canvas does. Each pane only reports where it is, how big, and how it looks.
 *
 * Each frame the layer records all of them into one Skia picture, on the UI thread, handing each
 * shader its uniforms as a flat list of numbers. Nothing is worked out per pane per frame anywhere
 * else, and a layer whose screen isn't showing does nothing at all.
 *
 * Why: a canvas per pane, each with its own per-frame work, cost a Galaxy S23 Ultra 31 ms a frame
 * scrolling Home, and the screens hidden under it kept doing their share.
 *
 * Layers: every screen, the tab bar, a sheet and the toast each have one. Glass outside any layer
 * still draws its own canvas, so nothing breaks if a layer is missing.
 *
 * Glass that scrolls is drawn by ScrollPanes instead, in strips that scroll with it (see there).
 *
 * Positions are in window points. A pane's box is its own box plus room for its shadow (MARGIN);
 * the canvas reaches MARGIN past the layer on every side so shadows at the edge aren't cut off.
 */
import { Canvas, Picture, Skia, type SkPicture } from '@shopify/react-native-skia';
import { useFocusEffect, useIsFocused } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Keyboard, PixelRatio, useWindowDimensions, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import { useAnimatedReaction, useFrameCallback, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { blendPose, coinPose, restingPose, type CoinKind } from '@shared/glass/coins';
import { effects } from './effects';
import { useGlass } from './GlassProvider';
import { useScreenPlace, type Place } from './origin';
import { layoutOf, pack, slotsOf } from './pack';

/** Room around a pane for its shadow. */
export const MARGIN = 26;

/** Until something is measured it sits far above the screen; below this it isn't drawn. */
const UNMEASURED = -5000;

/** The liquid's own uniforms, shared by the glass and the coin shaders. */
const LIQUID = ['uView', 'uL', 'uT', 'uGloss', 'uA0', 'uA1', 'uC1', 'uC2', 'uGlow', 'uBl', 'uTouch', 'uTouchA', 'uRip', 'uA0p', 'uA1p', 'uC1p', 'uC2p'];

/** Uniforms of a pane of glass that change only with the look, not with each frame. */
export interface SurfaceLook {
    uFrost: number;
    uTint: number;
    uTintK: number;
    uTintC: number[];
    uAcc: number[];
    uAcc2: number[];
    uRefract: number;
    uRim: number;
    uWobble: number;
    uLight: number;
    uRimC: number[];
    uShadow: number;
}

interface PaneBase {
    /** Drawing order: a pane drawn later sits on top. Parents render before their children. */
    order: number;
    place: Place;
    /** Measures the pane's place again (the layer asks after each render: see usePanes). */
    measure?: () => void;
    /** 0 to 1: a pane fades in when it appears, and a disabled button's glass is dimmed. */
    opacity: SharedValue<number>;
}

export interface SurfacePane extends PaneBase {
    kind: 'surface';
    size: SharedValue<number[]>;
    /** A button's press: the glass gives a little with the content. */
    scale: SharedValue<number>;
    radius: number;
    look: SurfaceLook;
}

export interface CoinPane extends PaneBase {
    kind: 'coin';
    coin: CoinKind;
    code: number;
    seed: number;
    radius: number;
    /** How far past its own box the coin and its shadow reach. */
    reach: number;
    light: number;
    rim: number[];
}

export type Pane = SurfacePane | CoinPane;

/** A pane as the layer keeps it: with the uniforms that don't change per frame already packed. */
interface Entry {
    pane: Pane;
    base: number[];
}

interface Layer {
    /** Adds a pane; the function it returns takes it away again. */
    add: (pane: Pane) => () => void;
    /**
     * Something in the layer changed size, so whatever is below it may have moved: every pane is
     * measured again on the next frame.
     */
    relayout: () => void;
}

const LayerContext = createContext<Layer | null>(null);

export const useLayer = () => useContext(LayerContext);

let ordinal = 0;
/** The next drawing order: called once, as a pane first renders. */
export const nextOrder = () => ++ordinal;

function emptyPicture(): SkPicture {
    'worklet';
    const recorder = Skia.PictureRecorder();
    recorder.beginRecording();
    return recorder.finishRecordingAsPicture();
}

function makeKit() {
    const { surface, coin } = effects();
    const surfaceLayout = layoutOf(surface);
    const coinLayout = layoutOf(coin);
    return { surface, coin, surfaceLayout, coinLayout, surfaceLiquid: slotsOf(surfaceLayout, LIQUID), coinLiquid: slotsOf(coinLayout, LIQUID) };
}

type Kit = ReturnType<typeof makeKit>;

/**
 * The panes of one layer, and keeping them measured. A pane measures itself when its own layout
 * changes, but not when something around it moves it (rows of a list trading places, a banner
 * appearing above): after every render of the screen, every pane is measured again, together, on
 * the next frame. So it is when anything in the layer changes size without the screen rendering:
 * a card growing a line when a person on the money map is chosen moved every pane below it, and
 * their glass stayed where it had been (a browser reports sizes only, never a move). Scrolling
 * needs none of this.
 */
function usePanes(also?: () => void) {
    const [entries, setEntries] = useState<Entry[]>([]);
    const kit = useMemo(() => makeKit(), []);
    const latest = useRef(entries);
    const pending = useRef(0);
    useEffect(() => {
        latest.current = entries;
    });
    const relayout = useCallback(() => {
        if (pending.current) return;
        pending.current = requestAnimationFrame(() => {
            pending.current = 0;
            also?.();
            for (const entry of latest.current) entry.pane.measure?.();
        });
    }, [also]);
    useEffect(() => () => cancelAnimationFrame(pending.current), []);

    useEffect(() => {
        const frameId = requestAnimationFrame(() => {
            also?.();
            for (const entry of entries) entry.pane.measure?.();
        });
        return () => cancelAnimationFrame(frameId);
    });

    // The keyboard moves things without a render (a chat's message box rides up on it and back down):
    // once it has opened or closed, and again when its slide has settled, every pane is measured again.
    useEffect(() => {
        const timers: ReturnType<typeof setTimeout>[] = [];
        const again = () => {
            for (const delay of [16, 120, 320]) timers.push(setTimeout(() => entries.forEach((entry) => entry.pane.measure?.()), delay));
        };
        const shown = Keyboard.addListener('keyboardDidShow', again);
        const hidden = Keyboard.addListener('keyboardDidHide', again);
        return () => {
            shown.remove();
            hidden.remove();
            timers.forEach(clearTimeout);
        };
    }, [entries]);

    const layer = useMemo<Layer>(
        () => ({
            add: (pane) => {
                const layout = pane.kind === 'surface' ? kit.surfaceLayout : kit.coinLayout;
                const base = new Array<number>(layout.size).fill(0);
                if (pane.kind === 'surface') pack(layout, { ...pane.look }, base);
                else pack(layout, { uKind: pane.code, uDetail: 1, uLight: pane.light, uRimC: pane.rim }, base);
                const entry: Entry = { pane, base };
                setEntries((list) => [...list.filter((other) => other.pane.order !== pane.order), entry].sort((a, b) => a.pane.order - b.pane.order));
                return () => setEntries((list) => list.filter((other) => other !== entry));
            },
            relayout,
        }),
        [kit, relayout],
    );

    return { entries, kit, layer };
}

/** A number that changes whenever anything drawn moves: the liquid, a scroll, a press, a fade. */
function signatureOf(entries: Entry[], t: number, rest: number, ox: number, oy: number) {
    'worklet';
    let sig = t * 7.13 + ox * 1.7 + oy * 2.3 + rest * 11.9 + entries.length * 0.29;
    for (const { pane } of entries) {
        const p = pane.place;
        sig += p.baseX.value * 0.37 + p.baseY.value * 0.53 + (p.scrollX ? p.scrollX.value * 0.71 : 0) + (p.scrollY ? p.scrollY.value * 0.91 : 0) + pane.opacity.value * 3.1;
        if (pane.kind === 'surface') sig += pane.scale.value * 5.3 + pane.size.value[0] * 0.13 + pane.size.value[1] * 0.17;
    }
    return sig;
}

/**
 * Records every pane that reaches into a canvas whose top-left corner is at (lx, ly) in window
 * points and which is w by h points (Infinity: the whole layer), with the liquid at this moment.
 */
function record(entries: Entry[], kit: Kit, L: Parameters<typeof pack>[1], t: number, rest: number, lx: number, ly: number, w: number, h: number): SkPicture {
    'worklet';
    const liquidSurface = new Array<number>(kit.surfaceLayout.size).fill(0);
    pack(kit.surfaceLayout, L, liquidSurface);
    const liquidCoin = new Array<number>(kit.coinLayout.size).fill(0);
    pack(kit.coinLayout, L, liquidCoin);
    const S = kit.surfaceLayout.slots;
    const C = kit.coinLayout.slots;

    const recorder = Skia.PictureRecorder();
    const canvas = recorder.beginRecording();
    for (const { pane, base } of entries) {
        const p = pane.place;
        if (p.baseY.value < UNMEASURED) continue;
        const x = p.baseX.value - (p.scrollX ? p.scrollX.value : 0);
        const y = p.baseY.value - (p.scrollY ? p.scrollY.value : 0);
        const u = base.slice();
        const paint = Skia.Paint();
        if (pane.kind === 'surface') {
            const [pw, ph] = pane.size.value;
            if (pw <= 0 || ph <= 0) continue;
            // Not in this canvas at all, shadow included.
            if (x + pw + MARGIN < lx || x - MARGIN > lx + w || y + ph + MARGIN < ly || y - MARGIN > ly + h) continue;
            const s = pane.scale.value;
            const sw = pw * s;
            const sh = ph * s;
            const left = x + (pw - sw) / 2;
            const top = y + (ph - sh) / 2;
            const ax = left - MARGIN - lx;
            const ay = top - MARGIN - ly;
            for (const i of kit.surfaceLiquid) u[i] = liquidSurface[i];
            u[S.uAt.slot] = ax;
            u[S.uAt.slot + 1] = ay;
            u[S.uOrigin.slot] = left - MARGIN;
            u[S.uOrigin.slot + 1] = top - MARGIN;
            u[S.uInset.slot] = MARGIN;
            u[S.uInset.slot + 1] = MARGIN;
            u[S.uSize.slot] = sw;
            u[S.uSize.slot + 1] = sh;
            u[S.uRadius.slot] = Math.min(pane.radius * s, sw / 2, sh / 2);
            paint.setShader(kit.surface.makeShader(u));
            paint.setAlphaf(pane.opacity.value);
            canvas.drawRect(Skia.XYWHRect(ax, ay, sw + MARGIN * 2, sh + MARGIN * 2), paint);
        } else {
            const r = pane.radius;
            const reach = pane.reach;
            if (x + r + reach < lx || x + r - reach > lx + w || y + r + reach < ly || y + r - reach > ly + h) continue;
            const moving = coinPose(pane.coin, pane.seed, t);
            const pose = rest > 0 ? blendPose(moving, restingPose(pane.coin, pane.seed), rest) : moving;
            for (const i of kit.coinLiquid) u[i] = liquidCoin[i];
            // The coin shader adds uOrigin to the canvas point to find the window point.
            u[C.uOrigin.slot] = lx;
            u[C.uOrigin.slot + 1] = ly;
            u[C.uC.slot] = x + r;
            u[C.uC.slot + 1] = y + r;
            u[C.uC.slot + 2] = r;
            u[C.uC.slot + 3] = pose.spin;
            u[C.uTilt.slot] = pose.axisX;
            u[C.uTilt.slot + 1] = pose.axisY;
            u[C.uTilt.slot + 2] = pose.lean;
            u[C.uTilt.slot + 3] = pose.facing;
            u[C.uCut.slot] = pose.cut;
            u[C.uCutAt.slot] = pose.cutAt;
            u[C.uFade.slot] = pane.opacity.value;
            paint.setShader(kit.coin.makeShader(u));
            canvas.drawRect(Skia.XYWHRect(x + r - reach - lx, y + r - reach - ly, reach * 2, reach * 2), paint);
        }
    }
    return recorder.finishRecordingAsPicture();
}

interface Props {
    style?: StyleProp<ViewStyle>;
    /** For layers outside any screen, such as the toast: always drawing, never paused. */
    always?: boolean;
    children?: ReactNode;
}

export function GlassLayer({ always, ...rest }: Props) {
    return always ? <LayerCanvas active {...rest} /> : <ScreenLayer {...rest} />;
}

/** A layer on a screen draws only while its screen is the one showing. */
function ScreenLayer(props: Omit<Props, 'always'>) {
    const focused = useIsFocused();
    return <LayerCanvas active={focused} {...props} />;
}

function LayerCanvas({ active, style, children }: Omit<Props, 'always'> & { active: boolean }) {
    const { time, liquid, still } = useGlass();
    const { ref, measure, place } = useScreenPlace();
    const { entries, kit, layer } = usePanes();
    const [blank] = useState(emptyPicture);
    const picture = useSharedValue<SkPicture>(blank);
    const signature = useSharedValue(Number.NaN);

    // A changed set of panes always draws again.
    useEffect(() => {
        signature.set(Number.NaN);
    }, [entries, signature]);

    const draw = useCallback(() => {
        'worklet';
        if (entries.length === 0) {
            if (signature.value !== -1) {
                signature.set(-1);
                picture.set(emptyPicture());
            }
            return;
        }
        if (place.baseY.value < UNMEASURED) return;
        const t = time.value;
        const rest = still.value;
        // The canvas's own top-left in window points: the layer's, less the margin it reaches past it.
        const lx = place.baseX.value - MARGIN - (place.scrollX ? place.scrollX.value : 0);
        const ly = place.baseY.value - MARGIN - (place.scrollY ? place.scrollY.value : 0);

        // Draw again only when something moved.
        const sig = signatureOf(entries, t, rest, lx, ly);
        if (sig === signature.value) return;
        signature.set(sig);
        picture.set(record(entries, kit, liquid.value, t, rest, lx, ly, Infinity, Infinity));
    }, [entries, kit, liquid, time, still, place, picture, signature]);

    const frame = useFrameCallback(draw, false);
    useEffect(() => {
        frame.setActive(active);
    }, [active, frame]);

    return (
        <LayerContext.Provider value={layer}>
            {/* zIndex keeps the canvas under the content everywhere, a browser included. */}
            <View ref={ref} onLayout={measure} style={[{ zIndex: 0 }, style]}>
                <Canvas style={{ position: 'absolute', left: -MARGIN, top: -MARGIN, right: -MARGIN, bottom: -MARGIN, pointerEvents: 'none', zIndex: -1 }}>
                    <Picture picture={picture} />
                </Canvas>
                {children}
            </View>
        </LayerContext.Provider>
    );
}

/** One strip of a scrolling layer's glass, and the picture it shows. */
interface Strip {
    index: number;
    picture: SharedValue<SkPicture>;
}

/** Strips are drawn this far before they scroll into view, so one never arrives empty. */
const AHEAD = 160;

/**
 * How long after its screen is left a page lets its strips go. Every canvas holds its own GPU
 * buffers: with each tab's strips kept, four tabs held 640 MB of graphics memory on a Galaxy S23
 * Ultra. Long enough for the screen leaving to finish fading with its glass on; coming back, the
 * strips are drawn again within a frame or two, while the screen is still fading in.
 */
const RELEASE_MS = 600;

/**
 * The glass inside a vertical scroll view, drawn in strips half a window tall that are part of the
 * scrolling content. A canvas behind the scroll view, as GlassLayer draws, can only follow a
 * scroll: the words move with the phone's own scrolling at once, and the canvas draws the glass at
 * its new place a frame or two later, so in a fast scroll every pane trailed behind its words.
 * A strip scrolls with the words themselves, and a pane sits in it where it sits in the content,
 * whatever the scroll, so they can't part. Only the liquid seen through the glass follows the
 * scroll a frame late, which the eye doesn't catch.
 *
 * Only the strips near the window are mounted, and only those near enough to be seen are drawn.
 * A pane across two strips is drawn in both, each canvas keeping its own part; the shaders work
 * from the pane's own corner, so the halves meet without a seam. Strips are a whole number of
 * pixels tall for the same reason.
 *
 * Glass in a sideways list inside (a row of chips, Home's groups) is drawn here too: it stays with
 * the page as it scrolls, and follows its own row's sideways scroll as the screen's layer did.
 */
export function ScrollPanes({ offset, children }: { offset: SharedValue<number>; children?: ReactNode }) {
    const root = useScreenPlace();
    // After each render of the screen its panes are measured again, as in GlassLayer. The strips'
    // own changes as the page scrolls happen in Strips, apart, and measure nothing: a measurement
    // taken mid-scroll would pair a place with a scroll from another frame.
    const { entries, kit, layer } = usePanes(root.measure);
    return (
        <LayerContext.Provider value={layer}>
            <Strips root={root} relayout={layer.relayout} entries={entries} kit={kit} offset={offset} />
            {children}
        </LayerContext.Provider>
    );
}

interface StripsProps {
    root: ReturnType<typeof useScreenPlace>;
    relayout: () => void;
    entries: Entry[];
    kit: Kit;
    offset: SharedValue<number>;
}

function Strips({ root, relayout, entries, kit, offset }: StripsProps) {
    const { ref, measure, place } = root;
    const focused = useIsFocused();
    const { time, liquid, still } = useGlass();
    const { height: windowHeight } = useWindowDimensions();
    const stripHeight = useMemo(() => PixelRatio.roundToNearestPixel(windowHeight / 2), [windowHeight]);
    const [box, setBox] = useState({ width: 0, height: 0 });
    const [range, setRange] = useState({ first: 0, last: 2 });
    const [strips, setStrips] = useState<Strip[]>([]);
    const signature = useSharedValue(Number.NaN);

    // A screen that isn't showing lets its strips go (RELEASE_MS), and takes them back when it is.
    const [released, setReleased] = useState(false);
    const releaseTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    useFocusEffect(
        useCallback(() => {
            clearTimeout(releaseTimer.current);
            setReleased(false);
            return () => {
                releaseTimer.current = setTimeout(() => setReleased(true), RELEASE_MS);
            };
        }, []),
    );
    useEffect(() => () => clearTimeout(releaseTimer.current), []);

    // The strips within one strip of the window are mounted, ready before they scroll into view.
    useAnimatedReaction(
        () => {
            const first = Math.max(0, Math.floor((offset.value - stripHeight) / stripHeight));
            const last = Math.floor((offset.value + windowHeight + stripHeight) / stripHeight);
            return first * 100_000 + last;
        },
        (now, before) => {
            if (now !== before) scheduleOnRN(setRange, { first: Math.floor(now / 100_000), last: now % 100_000 });
        },
        [stripHeight, windowHeight],
    );

    const register = useCallback((index: number, picture: SharedValue<SkPicture>) => {
        const strip: Strip = { index, picture };
        setStrips((list) => [...list.filter((other) => other.index !== index), strip]);
        return () => setStrips((list) => list.filter((other) => other !== strip));
    }, []);

    // A changed set of panes or strips always draws again.
    useEffect(() => {
        signature.set(Number.NaN);
    }, [entries, strips, signature]);

    const width = box.width + MARGIN * 2;
    const draw = useCallback(() => {
        'worklet';
        if (place.baseY.value < UNMEASURED || strips.length === 0) return;
        const t = time.value;
        const rest = still.value;
        // The content's top-left in window points, as it is now.
        const cx = place.baseX.value - (place.scrollX ? place.scrollX.value : 0);
        const cy = place.baseY.value - (place.scrollY ? place.scrollY.value : 0);

        const sig = signatureOf(entries, t, rest, cx, cy);
        if (sig === signature.value) return;
        signature.set(sig);
        for (const strip of strips) {
            const lx = cx - MARGIN;
            const ly = cy + strip.index * stripHeight;
            // Out of sight: it keeps its last picture, and is drawn again as it comes near.
            if (ly > windowHeight + AHEAD || ly + stripHeight < -AHEAD) continue;
            strip.picture.set(record(entries, kit, liquid.value, t, rest, lx, ly, width, stripHeight));
        }
    }, [entries, strips, kit, liquid, time, still, place, signature, stripHeight, windowHeight, width]);

    const frame = useFrameCallback(draw, false);
    useEffect(() => {
        frame.setActive(focused);
    }, [focused, frame]);

    const laidOut = (event: LayoutChangeEvent) => {
        const { width: w, height: h } = event.nativeEvent.layout;
        setBox((current) => (current.width === w && current.height === h ? current : { width: w, height: h }));
        measure();
        relayout();
    };

    // No strip past the content's end (its last pane's shadow included).
    const lastIndex = Math.min(range.last, Math.floor((box.height + MARGIN) / stripHeight));
    const indices: number[] = [];
    if (box.width > 0 && !released) for (let index = range.first; index <= lastIndex; index++) indices.push(index);

    return (
        // The content's own box: the strips sit in it, behind the words, and scroll with them.
        <View ref={ref} onLayout={laidOut} pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }}>
            {indices.map((index) => (
                <StripCanvas key={index} index={index} top={index * stripHeight} width={width} height={stripHeight} register={register} />
            ))}
        </View>
    );
}

function StripCanvas({ index, top, width, height, register }: { index: number; top: number; width: number; height: number; register: (index: number, picture: SharedValue<SkPicture>) => () => void }) {
    const [blank] = useState(emptyPicture);
    const picture = useSharedValue<SkPicture>(blank);
    useEffect(() => register(index, picture), [index, picture, register]);
    return (
        <Canvas style={{ position: 'absolute', left: -MARGIN, top, width, height, pointerEvents: 'none' }}>
            <Picture picture={picture} />
        </Canvas>
    );
}
