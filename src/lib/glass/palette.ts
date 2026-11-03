import type { PaletteId } from '@/hooks/useTheme';

export type GlassMode = 'light' | 'dark';
export type Rgb = [number, number, number];

/** A palette's one hue, how vivid it runs, and how light its filled buttons are. */
export interface GlassTheme {
    h: number;
    c: number;
    l: number;
}

/** Everything the shaders paint with: several depths of one hue, nothing else. */
export interface GlassPalette {
    a0: Rgb;
    a1: Rgb;
    c1: Rgb;
    c2: Rgb;
    glow: Rgb;
    tint: Rgb;
    tintK: number;
    acc: Rgb;
    rim: Rgb;
    shadow: number;
    light: number;
}

export const DEFAULT_GLASS_PALETTE: PaletteId = 'amethyst-haze';

export const GLASS_THEMES: Record<PaletteId, GlassTheme> = {
    'amethyst-haze': { h: 293, c: 1, l: 0.58 },
    'cosmic-night': { h: 277, c: 1, l: 0.58 },
    'bold-tech': { h: 258, c: 1, l: 0.58 },
    'sky-blue': { h: 237, c: 0.9, l: 0.74 },
    'ocean-breeze': { h: 212, c: 0.85, l: 0.76 },
    perpetuity: { h: 182, c: 0.8, l: 0.76 },
    'emerald-glow': { h: 160, c: 0.85, l: 0.76 },
    'lime-fusion': { h: 128, c: 0.95, l: 0.82 },
    'amber-minimal': { h: 72, c: 0.9, l: 0.82 },
    'solar-dusk': { h: 45, c: 1, l: 0.7 },
    'cherry-blossom': { h: 17, c: 1, l: 0.58 },
    'quantum-rose': { h: 354, c: 1, l: 0.58 },
    cyberpunk: { h: 322, c: 1, l: 0.58 },
    'copper-glow': { h: 50, c: 0.62, l: 0.56 },
    'merlot-night': { h: 8, c: 0.78, l: 0.5 },
    'graphite-mono': { h: 265, c: 0.16, l: 0.46 },
};

/** OKLCH to gamma-encoded sRGB, clamped. The shaders mix in this space on purpose: it is what the design was judged in. */
export function oklchToSrgb(L: number, C: number, hDeg: number): Rgb {
    const h = (hDeg * Math.PI) / 180;
    const a = C * Math.cos(h);
    const b = C * Math.sin(h);
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
    const encode = (linear: number) => {
        const x = Math.max(0, Math.min(1, linear));
        return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
    };
    return [
        encode(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
        encode(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
        encode(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    ];
}

export function isGlassPalette(id: string | null | undefined): id is PaletteId {
    return !!id && Object.prototype.hasOwnProperty.call(GLASS_THEMES, id);
}

export function glassPalette(id: string | null | undefined, mode: GlassMode): GlassPalette {
    const { h, c, l } = GLASS_THEMES[isGlassPalette(id) ? id : DEFAULT_GLASS_PALETTE];
    const acc = oklchToSrgb(l, 0.2 * c, h);
    if (mode === 'light') {
        return {
            a0: oklchToSrgb(0.95, 0.03 * c, h),
            a1: oklchToSrgb(0.85, 0.085 * c, h),
            c1: oklchToSrgb(0.8, 0.13 * c, h),
            c2: oklchToSrgb(0.68, 0.18 * c, h),
            glow: [1, 1, 1],
            tint: [1, 1, 1],
            tintK: 1.1,
            acc,
            rim: [1, 1, 1],
            shadow: 0.2,
            light: 1,
        };
    }
    return {
        a0: oklchToSrgb(0.15, 0.05 * c, h),
        a1: oklchToSrgb(0.29, 0.11 * c, h),
        c1: oklchToSrgb(0.56, 0.2 * c, h),
        c2: oklchToSrgb(0.38, 0.17 * c, h),
        glow: oklchToSrgb(0.96, 0.035 * c, h),
        tint: oklchToSrgb(0.2, 0.055 * c, h),
        tintK: 1,
        acc,
        rim: [1, 1, 1],
        shadow: 0.42,
        light: 0,
    };
}
