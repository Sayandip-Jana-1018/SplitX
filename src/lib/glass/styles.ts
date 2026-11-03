/** The kinds of glass offered in Settings, applied across the whole app. */
export const GLASS_STYLE_IDS = ['liquid', 'frosted', 'crystal', 'tinted', 'pearl'] as const;
export type GlassStyleId = (typeof GLASS_STYLE_IDS)[number];

/** How heavy one surface is on the page; `data-glass` holds this. */
export const GLASS_KINDS = ['clear', 'thin', 'reg', 'thick', 'accent'] as const;
export type GlassKind = (typeof GLASS_KINDS)[number];

interface StyleRecipe {
    refract: number;
    disperse: number;
    rim: number;
    wobble: number;
    frostK: number;
    frostAdd: number;
    tintK: number;
    accent?: number;
}

const STYLES: Record<GlassStyleId, StyleRecipe> = {
    liquid: { refract: 1, disperse: 1, rim: 1, wobble: 1, frostK: 0.82, frostAdd: 0, tintK: 0.86 },
    frosted: { refract: 0.28, disperse: 0.2, rim: 0.6, wobble: 0, frostK: 1, frostAdd: 0.4, tintK: 1.15 },
    crystal: { refract: 1.4, disperse: 1.7, rim: 1.25, wobble: 0.6, frostK: 0.06, frostAdd: 0, tintK: 0.28 },
    tinted: { refract: 0.85, disperse: 0.6, rim: 0.9, wobble: 0.5, frostK: 0.7, frostAdd: 0, tintK: 1, accent: 0.52 },
    pearl: { refract: 0.16, disperse: 0, rim: 0.5, wobble: 0, frostK: 1, frostAdd: 0.5, tintK: 1.75 },
};

/** Frost 0 to 1. A negative tint tints with the accent colour instead of the page's. */
const KINDS: Record<GlassKind, { frost: number; tint: number }> = {
    clear: { frost: 0.02, tint: 0.03 },
    thin: { frost: 0.52, tint: 0.2 },
    reg: { frost: 0.7, tint: 0.34 },
    thick: { frost: 0.92, tint: 0.54 },
    accent: { frost: 0.6, tint: -0.84 },
};

export interface SurfaceLook {
    frost: number;
    tint: number;
    refract: number;
    disperse: number;
    rim: number;
    wobble: number;
}

function isGlassStyle(id: string | null | undefined): id is GlassStyleId {
    return (GLASS_STYLE_IDS as readonly string[]).includes(id ?? '');
}

function isGlassKind(id: string | null | undefined): id is GlassKind {
    return (GLASS_KINDS as readonly string[]).includes(id ?? '');
}

/** What one surface looks like: its own weight, under the person's choice of glass. */
export function surfaceLook(kindId: string | null | undefined, styleId: string | null | undefined): SurfaceLook {
    const kindName = isGlassKind(kindId) ? kindId : 'reg';
    const kind = KINDS[kindName];
    const style = STYLES[isGlassStyle(styleId) ? styleId : 'liquid'];
    let tint = kind.tint;
    if (tint > 0) {
        tint *= style.tintK;
        if (style.accent && kindName !== 'clear') tint = -Math.min(0.72, style.accent + kind.tint * 0.4);
    }
    return {
        frost: Math.min(1, kind.frost * style.frostK + style.frostAdd),
        tint,
        refract: style.refract,
        disperse: style.disperse,
        rim: style.rim,
        wobble: style.wobble,
    };
}
