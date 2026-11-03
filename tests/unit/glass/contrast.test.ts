import { describe, expect, it } from 'vitest';
import { GLASS_THEMES, glassPalette, type GlassMode, type Rgb } from '@/lib/glass/palette';
import { GLASS_KINDS, GLASS_STYLE_IDS, surfaceLook } from '@/lib/glass/styles';

/*
 * Words on glass stay readable with the liquid at its brightest and darkest behind
 * them. This does what the shader does to a colour (shaders.ts, tintOf and scene),
 * for every palette, mode, kind of glass and weight of surface.
 */
const linear = (x: number) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
const luminance = ([r, g, b]: Rgb) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
const contrast = (a: Rgb, b: Rgb) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
};
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp = (c: Rgb): Rgb => [Math.min(1, Math.max(0, c[0])), Math.min(1, Math.max(0, c[1])), Math.min(1, Math.max(0, c[2]))];

/** The shader's tintOf. */
function tintOf(colour: Rgb, tint: number, colored: boolean, palette: ReturnType<typeof glassPalette>): Rgb {
    const grey = 0.2126 * colour[0] + 0.7152 * colour[1] + 0.0722 * colour[2];
    const vivid = clamp(mix([grey, grey, grey], colour, 1.26));
    if (tint < 0) return mix(vivid, palette.acc, -tint);
    return mix(vivid, colored ? palette.tinted : palette.tint, Math.min(tint * palette.tintK, 0.94));
}

const INK: Record<GlassMode, Rgb> = { dark: [1, 1, 1], light: [0.11, 0.08, 0.2] };
const hexToRgb = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as Rgb;
const ON_ACCENT: Record<string, string> = {
    'sky-blue': '#06202f',
    'ocean-breeze': '#042229',
    perpetuity: '#03241f',
    'emerald-glow': '#03241a',
    'lime-fusion': '#162407',
    'amber-minimal': '#2b1b02',
    'solar-dusk': '#2a1002',
};

const NORMAL_TEXT = 4.5;
const LARGE_TEXT = 3;

describe('words on glass', () => {
    for (const id of Object.keys(GLASS_THEMES)) {
        for (const mode of ['dark', 'light'] as const) {
            const palette = glassPalette(id, mode);
            const behind: Rgb[] = [palette.a0, palette.a1, palette.c1, palette.c2];

            it(`can be read in ${id}, ${mode}, in every kind of glass`, () => {
                const failures: string[] = [];
                for (const style of GLASS_STYLE_IDS) {
                    for (const kind of GLASS_KINDS) {
                        const look = surfaceLook(kind, style);
                        for (const colour of behind) {
                            const surface = tintOf(colour, look.tint, look.colored, palette);
                            const ink = look.tint < 0 ? hexToRgb(ON_ACCENT[id] ?? '#ffffff') : INK[mode];
                            const ratio = contrast(surface, ink);
                            // Clear glass carries short labels on buttons, so it is held to the large-text bar.
                            const bar = kind === 'clear' ? LARGE_TEXT : NORMAL_TEXT;
                            if (ratio < bar) failures.push(`${style} ${kind}: ${ratio.toFixed(2)}`);
                        }
                    }
                }
                expect(failures).toEqual([]);
            });
        }
    }
});
