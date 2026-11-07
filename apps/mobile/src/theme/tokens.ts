/**
 * Every colour the app uses, from one palette's hue, the same way the website's stylesheets do
 * (src/styles/themes/dark.css, light.css). Each palette is one hue run at different depths.
 */
import { GLASS_THEMES, oklchToSrgb, type GlassMode, type PaletteId, type Rgb } from '@shared/glass/palette';

export interface Tokens {
    mode: GlassMode;
    bg: string;
    fg: string;
    fg2: string;
    fg3: string;
    muted: string;
    border: string;
    borderStrong: string;
    /** Words and icons that should read as the palette's colour. */
    accentText: string;
    /** A filled button's colour, and the words on it. */
    accent: string;
    onAccent: string;
    moneyIn: string;
    moneyOut: string;
    danger: string;
    chip: string;
    /** A soft shadow behind words that sit straight on the liquid. */
    inkShadow: string;
    swatch: (paletteId: PaletteId) => string;
}

export function rgbString([r, g, b]: Rgb, alpha = 1): string {
    const to255 = (v: number) => Math.round(v * 255);
    return alpha >= 1 ? `rgb(${to255(r)},${to255(g)},${to255(b)})` : `rgba(${to255(r)},${to255(g)},${to255(b)},${alpha})`;
}

function luminance([r, g, b]: Rgb): number {
    const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function tokensFor(paletteId: PaletteId, mode: GlassMode): Tokens {
    const { h, c, l } = GLASS_THEMES[paletteId];
    const ok = (L: number, C: number, alpha = 1) => rgbString(oklchToSrgb(L, C * c, h), alpha);
    const fill = oklchToSrgb(l, 0.2 * c, h);
    // Light fills (Sky, Lagoon, Lime…) carry dark words, as on the web.
    const onAccent = luminance(fill) > 0.36 ? ok(0.2, 0.05) : '#ffffff';
    const swatch = (id: PaletteId) => {
        const theme = GLASS_THEMES[id];
        return rgbString(oklchToSrgb(theme.l, 0.2 * theme.c, theme.h));
    };

    if (mode === 'dark') {
        return {
            mode,
            bg: ok(0.13, 0.04),
            fg: '#ffffff',
            fg2: 'rgba(255,255,255,0.8)',
            fg3: 'rgba(255,255,255,0.66)',
            muted: 'rgba(255,255,255,0.58)',
            border: 'rgba(255,255,255,0.14)',
            borderStrong: 'rgba(255,255,255,0.24)',
            accentText: ok(0.82, 0.13),
            accent: rgbString(fill),
            onAccent,
            moneyIn: ok(0.92, 0.09),
            moneyOut: 'rgba(255,255,255,0.82)',
            danger: 'rgb(244,63,94)',
            chip: 'rgba(255,255,255,0.08)',
            inkShadow: 'rgba(0,0,0,0.28)',
            swatch,
        };
    }
    return {
        mode,
        bg: ok(0.955, 0.022),
        fg: ok(0.2, 0.05),
        fg2: ok(0.28, 0.05, 0.9),
        fg3: ok(0.34, 0.05, 0.82),
        muted: ok(0.38, 0.05, 0.76),
        border: ok(0.25, 0.04, 0.16),
        borderStrong: ok(0.25, 0.04, 0.26),
        accentText: ok(0.45, 0.2),
        accent: rgbString(fill),
        onAccent,
        moneyIn: ok(0.42, 0.17),
        moneyOut: ok(0.3, 0.05, 0.88),
        danger: 'rgb(225,29,72)',
        chip: 'rgba(255,255,255,0.42)',
        inkShadow: 'rgba(255,255,255,0.0)',
        swatch,
    };
}
