/** What every shader needs to draw the liquid at one moment. Runs on the UI thread. */
import { floatBlobs, lightBase } from '@shared/glass/liquid';
import type { GlassPalette } from '@shared/glass/palette';

export function liquidUniforms(t: number, width: number, height: number, pal: GlassPalette) {
    'worklet';
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
    };
}
