/**
 * The palettes, owned here so this file imports nothing: the phone app (apps/mobile) reads it
 * as it is, and both show the same colours.
 */
export type PaletteId =
    | 'amethyst-haze' | 'cosmic-night' | 'bold-tech' | 'sky-blue' | 'ocean-breeze'
    | 'perpetuity' | 'emerald-glow' | 'lime-fusion' | 'amber-minimal' | 'solar-dusk'
    | 'cherry-blossom' | 'quantum-rose' | 'cyberpunk'
    | 'copper-glow' | 'graphite-mono' | 'merlot-night'
    | 'coral' | 'matcha' | 'ice' | 'champagne' | 'slate' | 'midnight'
    | 'noir-gold' | 'royal' | 'emerald-gold' | 'rose-gold' | 'ocean' | 'berry' | 'ember' | 'peach';

export const PALETTE_NAMES: Record<PaletteId, string> = {
    'amethyst-haze': 'Amethyst',
    'cosmic-night': 'Indigo',
    'bold-tech': 'Cobalt',
    'sky-blue': 'Sky',
    'ocean-breeze': 'Lagoon',
    perpetuity: 'Teal',
    'emerald-glow': 'Emerald',
    'lime-fusion': 'Lime',
    'amber-minimal': 'Amber',
    'solar-dusk': 'Sunset',
    'cherry-blossom': 'Rose',
    'quantum-rose': 'Blush',
    cyberpunk: 'Orchid',
    'copper-glow': 'Copper',
    'merlot-night': 'Merlot',
    'graphite-mono': 'Graphite',
    coral: 'Coral',
    matcha: 'Matcha',
    ice: 'Ice',
    champagne: 'Champagne',
    slate: 'Slate',
    midnight: 'Midnight',
    'noir-gold': 'Noir Gold',
    royal: 'Royal',
    'emerald-gold': 'Jade Gold',
    'rose-gold': 'Rose Gold',
    ocean: 'Ocean',
    berry: 'Berry',
    ember: 'Ember',
    peach: 'Peach',
};

export type GlassMode = 'light' | 'dark';
export type Rgb = [number, number, number];

/** A colour as OKLCH: lightness 0 to 1, chroma (about 0 to 0.3), hue in degrees. */
interface Lch {
    l: number;
    c: number;
    h: number;
}

/**
 * A blend: the page has a colour of its own (near black, navy, deep green, plum…) and two colours
 * float in the liquid, either a luxe pairing (gold on black) or near neighbours on the wheel
 * (blue, teal, sea green), never far-apart hues fighting each other. Words, numbers and filled
 * buttons keep the palette's accent (`h`, `c`, `l`), so a page still reads in one colour.
 */
interface Blend {
    /** The page's hue, and its chroma (0 is black and white). */
    base: { h: number; c: number };
    /** The two floating colours, as dark mode shows them; light mode lifts them. */
    blobs: readonly [Lch, Lch];
}

/** A palette's one hue, how vivid it runs, and how light its filled buttons are. */
export interface GlassTheme {
    h: number;
    c: number;
    l: number;
    blend?: Blend;
    /** Dark mode's page is near black (for OLED screens), not the hue's deepest shade. */
    deep?: boolean;
}

/** Everything the shaders paint with: several depths of one hue (or, in a blend, of three). */
export interface GlassPalette {
    a0: Rgb;
    a1: Rgb;
    c1: Rgb;
    c2: Rgb;
    glow: Rgb;
    tint: Rgb;
    tintK: number;
    /** What Tinted glass tints with: deep enough, or pale enough, for the page's words. */
    tinted: Rgb;
    acc: Rgb;
    /** Where a filled button's colour runs to: the same as `acc`, but in a blend a sheen a little deeper and warmer. */
    acc2: Rgb;
    rim: Rgb;
    shadow: number;
    light: number;
}

export const DEFAULT_GLASS_PALETTE: PaletteId = 'amethyst-haze';

export const GLASS_THEMES: Record<PaletteId, GlassTheme> = {
    'amethyst-haze': { h: 293, c: 1, l: 0.54 },
    'cosmic-night': { h: 277, c: 1, l: 0.54 },
    'bold-tech': { h: 258, c: 1, l: 0.53 },
    'sky-blue': { h: 237, c: 0.9, l: 0.77 },
    'ocean-breeze': { h: 212, c: 0.85, l: 0.79 },
    perpetuity: { h: 182, c: 0.8, l: 0.79 },
    'emerald-glow': { h: 160, c: 0.85, l: 0.79 },
    'lime-fusion': { h: 128, c: 0.95, l: 0.82 },
    'amber-minimal': { h: 72, c: 0.9, l: 0.82 },
    'solar-dusk': { h: 45, c: 1, l: 0.7 },
    'cherry-blossom': { h: 17, c: 1, l: 0.54 },
    'quantum-rose': { h: 354, c: 1, l: 0.54 },
    cyberpunk: { h: 322, c: 1, l: 0.53 },
    'copper-glow': { h: 50, c: 0.62, l: 0.52 },
    'merlot-night': { h: 8, c: 0.78, l: 0.5 },
    'graphite-mono': { h: 265, c: 0.16, l: 0.46 },
    coral: { h: 30, c: 1, l: 0.53 },
    matcha: { h: 128, c: 0.55, l: 0.8 },
    ice: { h: 210, c: 0.45, l: 0.82 },
    champagne: { h: 80, c: 0.35, l: 0.8 },
    slate: { h: 245, c: 0.3, l: 0.52 },
    midnight: { h: 268, c: 0.3, l: 0.5, deep: true },
    // Luxe pairings: gold or rose gold on a deep page.
    'noir-gold': { h: 85, c: 0.65, l: 0.8, deep: true, blend: { base: { h: 85, c: 0.012 }, blobs: [{ l: 0.6, c: 0.11, h: 82 }, { l: 0.42, c: 0.09, h: 62 }] } },
    royal: { h: 85, c: 0.65, l: 0.8, blend: { base: { h: 250, c: 0.07 }, blobs: [{ l: 0.6, c: 0.11, h: 82 }, { l: 0.38, c: 0.1, h: 248 }] } },
    'emerald-gold': { h: 85, c: 0.65, l: 0.8, blend: { base: { h: 162, c: 0.07 }, blobs: [{ l: 0.46, c: 0.11, h: 160 }, { l: 0.6, c: 0.11, h: 82 }] } },
    'rose-gold': { h: 35, c: 0.45, l: 0.76, blend: { base: { h: 345, c: 0.08 }, blobs: [{ l: 0.6, c: 0.08, h: 32 }, { l: 0.42, c: 0.11, h: 345 }] } },
    // Near neighbours on the wheel, like a photograph's own colours.
    ocean: { h: 228, c: 0.9, l: 0.5, blend: { base: { h: 232, c: 0.1 }, blobs: [{ l: 0.52, c: 0.11, h: 205 }, { l: 0.48, c: 0.1, h: 172 }] } },
    berry: { h: 318, c: 1, l: 0.52, blend: { base: { h: 300, c: 0.12 }, blobs: [{ l: 0.52, c: 0.2, h: 295 }, { l: 0.56, c: 0.2, h: 342 }] } },
    ember: { h: 22, c: 1, l: 0.53, blend: { base: { h: 12, c: 0.1 }, blobs: [{ l: 0.46, c: 0.16, h: 15 }, { l: 0.58, c: 0.14, h: 42 }] } },
    peach: { h: 32, c: 0.8, l: 0.74, blend: { base: { h: 352, c: 0.08 }, blobs: [{ l: 0.52, c: 0.12, h: 10 }, { l: 0.62, c: 0.1, h: 55 }] } },
};

/** A blend: two or three colours in the liquid (see GlassTheme.blend). */
export function isBlend(id: PaletteId): boolean {
    return Boolean(GLASS_THEMES[id].blend);
}

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
    const { h, c, l, blend, deep } = GLASS_THEMES[isGlassPalette(id) ? id : DEFAULT_GLASS_PALETTE];
    const acc = oklchToSrgb(l, 0.2 * c, h);
    // A blend's buttons catch a sheen: the same colour a little deeper and warmer across them.
    const acc2 = blend ? oklchToSrgb(l - 0.07, 0.2 * c, h - 14) : acc;
    const base = blend?.base ?? { h, c: 0 };
    const [b1, b2] = blend?.blobs ?? [];
    if (mode === 'light') {
        return {
            a0: blend ? oklchToSrgb(0.96, base.c * 0.25, base.h) : oklchToSrgb(0.95, 0.03 * c, h),
            a1: blend ? oklchToSrgb(0.88, base.c * 0.6, base.h) : oklchToSrgb(0.85, 0.085 * c, h),
            c1: b1 ? oklchToSrgb(Math.min(0.86, b1.l + 0.16), b1.c * 0.75, b1.h) : oklchToSrgb(0.8, 0.13 * c, h),
            c2: b2 ? oklchToSrgb(Math.min(0.82, b2.l + 0.2), b2.c * 0.8, b2.h) : oklchToSrgb(0.68, 0.18 * c, h),
            glow: [1, 1, 1],
            tint: [1, 1, 1],
            tintK: 1.1,
            tinted: oklchToSrgb(0.86, 0.09 * c, h),
            acc,
            acc2,
            rim: [1, 1, 1],
            shadow: 0.2,
            light: 1,
        };
    }
    return {
        a0: blend ? oklchToSrgb(deep ? 0.07 : 0.13, base.c * 0.4, base.h) : oklchToSrgb(deep ? 0.07 : 0.15, 0.05 * c, h),
        a1: blend ? oklchToSrgb(deep ? 0.19 : 0.25, base.c, base.h) : oklchToSrgb(deep ? 0.2 : 0.29, 0.11 * c, h),
        c1: b1 ? oklchToSrgb(b1.l, b1.c, b1.h) : oklchToSrgb(0.56, 0.2 * c, h),
        c2: b2 ? oklchToSrgb(b2.l, b2.c, b2.h) : oklchToSrgb(0.38, 0.17 * c, h),
        glow: oklchToSrgb(0.96, 0.035 * c, h),
        // A blend's glass is tinted by its page, a single colour's by its own hue.
        tint: blend ? oklchToSrgb(0.2, base.c * 0.6, base.h) : oklchToSrgb(0.2, 0.055 * c, h),
        tintK: 1,
        tinted: oklchToSrgb(0.38, 0.14 * c, h),
        acc,
        acc2,
        rim: [1, 1, 1],
        shadow: 0.42,
        light: 0,
    };
}
