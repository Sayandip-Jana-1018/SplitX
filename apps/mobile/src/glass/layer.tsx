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
 * Positions are in window points. A pane's box is its own box plus room for its shadow (MARGIN);
 * the canvas reaches MARGIN past the layer on every side so shadows at the edge aren't cut off.
 */
import { Canvas, Picture, Skia, type SkPicture } from '@shopify/react-native-skia';
import { useIsFocused } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { useFrameCallback, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { coinPose, type CoinKind } from '@shared/glass/coins';
import { effects } from './effects';
import { useGlass } from './GlassProvider';
import { useScreenPlace, type Place } from './origin';
import { layoutOf, pack, slotsOf } from './pack';

/** Room around a pane for its shadow. */
export const MARGIN = 26;

/** Until something is measured it sits far above the screen; below this it isn't drawn. */
const UNMEASURED = -5000;

/** The liquid's own uniforms, shared by the glass and the coin shaders. */
const LIQUID = ['uView', 'uL', 'uT', 'uGloss', 'uA0', 'uA1', 'uC1', 'uC2', 'uGlow', 'uBl', 'uTouch', 'uTouchA'];

/** Uniforms of a pane of glass that change only with the look, not with each frame. */
export interface SurfaceLook {
    uFrost: number;
    uTint: number;
    uTintK: number;
    uTintC: number[];
    uAcc: number[];
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
    const { time, liquid } = useGlass();
    const { ref, measure, place } = useScreenPlace();
    const [entries, setEntries] = useState<Entry[]>([]);
    const [blank] = useState(emptyPicture);
    const picture = useSharedValue<SkPicture>(blank);
    const signature = useSharedValue(Number.NaN);

    const kit = useMemo(() => {
        const { surface, coin } = effects();
        const surfaceLayout = layoutOf(surface);
        const coinLayout = layoutOf(coin);
        return { surface, coin, surfaceLayout, coinLayout, surfaceLiquid: slotsOf(surfaceLayout, LIQUID), coinLiquid: slotsOf(coinLayout, LIQUID) };
    }, []);

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
        }),
        [kit],
    );

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
        const t = time.value;
        // The canvas's own top-left in window points: the layer's, less the margin it reaches past it.
        const lx = place.baseX.value - MARGIN - (place.scrollX ? place.scrollX.value : 0);
        const ly = place.baseY.value - MARGIN - (place.scrollY ? place.scrollY.value : 0);

        // Draw again only when something moved: the liquid, a scroll, a press, a fade.
        let sig = t * 7.13 + lx * 1.7 + ly * 2.3;
        for (const { pane } of entries) {
            const p = pane.place;
            sig += p.baseX.value * 0.37 + p.baseY.value * 0.53 + (p.scrollX ? p.scrollX.value * 0.71 : 0) + (p.scrollY ? p.scrollY.value * 0.91 : 0) + pane.opacity.value * 3.1;
            if (pane.kind === 'surface') sig += pane.scale.value * 5.3 + pane.size.value[0] * 0.13 + pane.size.value[1] * 0.17;
        }
        if (sig === signature.value) return;
        signature.set(sig);

        const L = liquid.value;
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
            const x = p.baseX.value - (p.scrollX ? p.scrollX.value : 0);
            const y = p.baseY.value - (p.scrollY ? p.scrollY.value : 0);
            if (y < UNMEASURED || ly < UNMEASURED) continue;
            const u = base.slice();
            const paint = Skia.Paint();
            if (pane.kind === 'surface') {
                const [w, h] = pane.size.value;
                if (w <= 0 || h <= 0) continue;
                const s = pane.scale.value;
                const sw = w * s;
                const sh = h * s;
                const left = x + (w - sw) / 2;
                const top = y + (h - sh) / 2;
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
                const pose = coinPose(pane.coin, pane.seed, t);
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
                canvas.drawRect(Skia.XYWHRect(x + r - pane.reach - lx, y + r - pane.reach - ly, pane.reach * 2, pane.reach * 2), paint);
            }
        }
        picture.set(recorder.finishRecordingAsPicture());
    }, [entries, kit, liquid, time, place, picture, signature]);

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
