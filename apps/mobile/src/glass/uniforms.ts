/** What every shader needs to draw the liquid at one moment. Runs on the UI thread. */
import { floatBlobs, lightBase } from '@shared/glass/liquid';
import type { GlassPalette } from '@shared/glass/palette';

/** How long a touch's ring takes to spread and fade, in seconds, as on the website (TOUCH_MS). */
export const TOUCH_S = 0.85;

/** `touch` is [x, y, when] on the liquid's clock; `when` below zero means no touch. */
export function liquidUniforms(t: number, width: number, height: number, pal: GlassPalette, touch: number[]) {
    'worklet';
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
        uTouch: [touch[0], touch[1], touching ? (1 - (1 - p) ** 2) * 170 : 0],
        uTouchA: touching ? 1 - p : 0,
    };
}
