import { describe, expect, it } from 'vitest';
import { COLOR_PALETTES } from '@/hooks/useTheme';
import { DEFAULT_GLASS_PALETTE, GLASS_THEMES, glassPalette, isGlassPalette, oklchToSrgb } from '@/lib/glass/palette';

describe('the glass palette', () => {
    it('knows every palette a person can have saved, and nothing else', () => {
        expect(Object.keys(GLASS_THEMES).sort()).toEqual(COLOR_PALETTES.map((p) => p.id).sort());
    });

    it('converts known colours', () => {
        expect(oklchToSrgb(1, 0, 0).map((x) => +x.toFixed(3))).toEqual([1, 1, 1]);
        expect(oklchToSrgb(0, 0, 0)).toEqual([0, 0, 0]);
        // sRGB red is oklch(0.628 0.2577 29.23).
        const [r, g, b] = oklchToSrgb(0.628, 0.2577, 29.23);
        expect(r).toBeGreaterThan(0.99);
        expect(g).toBeLessThan(0.02);
        expect(b).toBeLessThan(0.02);
    });

    it('stays inside what a screen can show, for every palette in both modes', () => {
        for (const id of Object.keys(GLASS_THEMES)) {
            for (const mode of ['light', 'dark'] as const) {
                const palette = glassPalette(id, mode);
                for (const colour of [palette.a0, palette.a1, palette.c1, palette.c2, palette.acc, palette.tint, palette.glow]) {
                    for (const channel of colour) {
                        expect(channel).toBeGreaterThanOrEqual(0);
                        expect(channel).toBeLessThanOrEqual(1);
                    }
                }
            }
        }
    });

    it('makes the page dark in dark mode and light in light mode', () => {
        const luma = ([r, g, b]: number[]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
        for (const id of Object.keys(GLASS_THEMES)) {
            expect(luma(glassPalette(id, 'dark').a0)).toBeLessThan(0.15);
            expect(luma(glassPalette(id, 'light').a0)).toBeGreaterThan(0.85);
        }
    });

    it('falls back to the default for a palette it does not know', () => {
        expect(isGlassPalette('pastel-dreams')).toBe(false);
        expect(isGlassPalette('toString')).toBe(false);
        expect(isGlassPalette(null)).toBe(false);
        expect(glassPalette('pastel-dreams', 'dark')).toEqual(glassPalette(DEFAULT_GLASS_PALETTE, 'dark'));
    });
});
