/** What every shader needs to draw the liquid at one moment. Runs on the UI thread. */
import { floatBlobs, lightBase } from '@shared/glass/liquid';
import type { GlassPalette } from '@shared/glass/palette';

/** How long a touch's waves take to spread and settle, in seconds: slower than the website's 0.85, for a calmer, wider ripple. */
export const TOUCH_S = 1.6;

/** How far the waves travel from the finger, in points. */
const TOUCH_REACH = 360;

/** How long a new colour takes to spread across the screen, as on the website (RIPPLE_MS). */
export const RIPPLE_S = 1.1;

/**
 * `touch` and `rip` are [x, y, when] on the liquid's clock; `when` below zero means none. `before`
 * is the palette a theme ripple spreads over.
 */
export function liquidUniforms(t: number, width: number, height: number, pal: GlassPalette, touch: number[], before: GlassPalette, rip: number[]) {
    'worklet';
    const rp = rip[2] < 0 ? 1 : (t - rip[2]) / RIPPLE_S;
    const rippling = rp >= 0 && rp < 1;
    // Far enough to reach the furthest corner from where it started.
    const reach = Math.max(Math.hypot(rip[0], rip[1]), Math.hypot(width - rip[0], rip[1]), Math.hypot(rip[0], height - rip[1]), Math.hypot(width - rip[0], height - rip[1])) + 60;
    const p = touch[2] < 0 ? 1 : (t - touch[2]) / TOUCH_S;
    const touching = p >= 0 && p < 1;
    const flat: number[] = [];
    floatBlobs(t, width, height, flat);
    const blobs: number[][] = [];
    for (let i = 0; i < 7; i++) blobs.push([flat[i * 3], flat[i * 3 + 1], flat[i * 3 + 2]]);
    const [lx, ly] = lightBase(t);
    const length = Math.hypot(lx, ly) || 1;
    return {
        uView: [width, height],
        uL: [lx / length, ly / length],
        uT: t,
        uGloss: 1,
        uA0: pal.a0,
        uA1: pal.a1,
        uC1: pal.c1,
        uC2: pal.c2,
        uGlow: pal.glow,
        uBl: blobs,
        // The front eases out (fast, then gliding to a stop); the waves fade in over the first
        // tenth of a second rather than popping, then die away as they spread.
        uTouch: [touch[0], touch[1], touching ? (1 - (1 - p) ** 3) * TOUCH_REACH : 0],
        uTouchA: touching ? Math.min(1, p / 0.06) * (1 - p) ** 1.6 : 0,
        uRip: [rip[0], rip[1], rippling ? (1 - (1 - rp) ** 3) * reach : -1],
        uA0p: before.a0,
        uA1p: before.a1,
        uC1p: before.c1,
        uC2p: before.c2,
    };
}
