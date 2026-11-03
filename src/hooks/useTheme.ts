'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { GLASS_THEMES, glassPalette } from '@/lib/glass/palette';
import { GLASS_STYLE_IDS, type GlassStyleId } from '@/lib/glass/styles';

export type ThemePreference = 'light' | 'dark' | 'system';
export type MotionPreference = 'full' | 'calm';
export type ResolvedTheme = 'light' | 'dark';

export type PaletteId =
    | 'amethyst-haze' | 'cosmic-night' | 'bold-tech' | 'sky-blue' | 'ocean-breeze'
    | 'perpetuity' | 'emerald-glow' | 'lime-fusion' | 'amber-minimal' | 'solar-dusk'
    | 'cherry-blossom' | 'quantum-rose' | 'cyberpunk'
    | 'copper-glow' | 'graphite-mono' | 'merlot-night';

export interface ColorPalette {
    id: PaletteId;
    name: string;
    /** Three depths of the palette's one hue, for its swatch. */
    swatches: string[];
}

const THEME_STORAGE_KEY = 'SplitX-theme';
const PALETTE_STORAGE_KEY = 'SplitX-palette';
const GLASS_STORAGE_KEY = 'SplitX-glass';
const MOTION_STORAGE_KEY = 'SplitX-motion';
const DEFAULT_PALETTE: PaletteId = 'amethyst-haze';

const PALETTE_NAMES: Record<PaletteId, string> = {
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
};

/** The palettes on offer. The colours themselves come from one hue each (lib/glass/palette.ts). */
export const COLOR_PALETTES: ColorPalette[] = (Object.keys(PALETTE_NAMES) as PaletteId[]).map((id) => {
    const { h, c, l } = GLASS_THEMES[id];
    return {
        id,
        name: PALETTE_NAMES[id],
        swatches: [`oklch(0.8 ${0.13 * c} ${h})`, `oklch(${l} ${0.2 * c} ${h})`, `oklch(0.5 ${0.2 * c} ${h})`],
    };
});

const LEGACY_PALETTES: Record<string, PaletteId> = {
    'pastel-dreams': 'amethyst-haze',
    'lavender-mist': 'amethyst-haze',
    'midnight-indigo': 'cosmic-night',
    tangerine: 'solar-dusk',
    'warm-coral': 'cherry-blossom',
};

function normalizePalette(value: string | null): PaletteId {
    if (!value) return DEFAULT_PALETTE;
    if (COLOR_PALETTES.some((palette) => palette.id === value)) return value as PaletteId;
    return LEGACY_PALETTES[value] ?? DEFAULT_PALETTE;
}

function normalizeGlass(value: string | null): GlassStyleId {
    return (GLASS_STYLE_IDS as readonly string[]).includes(value ?? '') ? (value as GlassStyleId) : 'liquid';
}

function normalizePreference(value: string | null): ThemePreference {
    return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
}

/* ─────────────────────────────────────────────────────────────
   External store — keeps every consumer in sync, survives
   re-mounts and reacts to OS theme + other tabs.
   ───────────────────────────────────────────────────────────── */

interface ThemeState {
    preference: ThemePreference;
    palette: PaletteId;
    glass: GlassStyleId;
    motion: MotionPreference;
    systemDark: boolean;
}

const SERVER_STATE: ThemeState = { preference: 'system', palette: DEFAULT_PALETTE, glass: 'liquid', motion: 'full', systemDark: true };
const listeners = new Set<() => void>();
let current: ThemeState | null = null;

function readState(): ThemeState {
    let preference: ThemePreference = 'system';
    let palette: PaletteId = DEFAULT_PALETTE;
    let glass: GlassStyleId = 'liquid';
    let motion: MotionPreference = 'full';
    try {
        preference = normalizePreference(localStorage.getItem(THEME_STORAGE_KEY));
        palette = normalizePalette(localStorage.getItem(PALETTE_STORAGE_KEY));
        glass = normalizeGlass(localStorage.getItem(GLASS_STORAGE_KEY));
        motion = localStorage.getItem(MOTION_STORAGE_KEY) === 'calm' ? 'calm' : 'full';
    } catch {
        // storage unavailable (private mode) — fall back to defaults
    }
    const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    return { preference, palette, glass, motion, systemDark };
}

function resolveTheme(state: ThemeState): ResolvedTheme {
    if (state.preference === 'system') return state.systemDark ? 'dark' : 'light';
    return state.preference;
}

function applyToDocument(state: ThemeState) {
    const root = document.documentElement;
    const resolved = resolveTheme(state);
    root.setAttribute('data-theme', resolved);
    root.setAttribute('data-palette', state.palette);
    root.setAttribute('data-glass-style', state.glass);
    root.setAttribute('data-motion', state.motion);
    root.style.colorScheme = resolved;

    // Clean up inline overrides written by older builds
    for (const prop of ['--accent-300', '--accent-400', '--accent-500', '--accent-600', '--accent-500-rgb']) {
        root.style.removeProperty(prop);
    }

    // The phone's status bar follows the page's deepest colour.
    const [r, g, b] = glassPalette(state.palette, resolved).a0.map((x) => Math.round(x * 255));
    document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
        meta.setAttribute('content', `rgb(${r}, ${g}, ${b})`);
    });

    document.cookie = `theme=${resolved};path=/;max-age=31536000;samesite=lax`;
    document.cookie = `palette=${state.palette};path=/;max-age=31536000;samesite=lax`;
}

function getSnapshot(): ThemeState {
    if (!current) current = readState();
    return current;
}

function getServerSnapshot(): ThemeState {
    return SERVER_STATE;
}

function emit() {
    listeners.forEach((listener) => listener());
}

function update(partial: Partial<ThemeState>) {
    current = { ...getSnapshot(), ...partial };
    try {
        localStorage.setItem(THEME_STORAGE_KEY, current.preference);
        localStorage.setItem(PALETTE_STORAGE_KEY, current.palette);
        localStorage.setItem(GLASS_STORAGE_KEY, current.glass);
        localStorage.setItem(MOTION_STORAGE_KEY, current.motion);
    } catch {
        // ignore
    }
    applyToDocument(current);
    emit();
}

function subscribe(listener: () => void) {
    listeners.add(listener);
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onSystemChange = () => {
        current = { ...getSnapshot(), systemDark: media.matches };
        applyToDocument(current);
        emit();
    };
    const onStorage = (event: StorageEvent) => {
        if (event.key === null || ![THEME_STORAGE_KEY, PALETTE_STORAGE_KEY, GLASS_STORAGE_KEY, MOTION_STORAGE_KEY].includes(event.key)) return;
        current = readState();
        applyToDocument(current);
        emit();
    };
    media.addEventListener('change', onSystemChange);
    window.addEventListener('storage', onStorage);
    return () => {
        listeners.delete(listener);
        media.removeEventListener('change', onSystemChange);
        window.removeEventListener('storage', onStorage);
    };
}

const subscribeNoop = () => () => undefined;

export function useTheme() {
    const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
    const mounted = useSyncExternalStore(subscribeNoop, () => true, () => false);
    const theme = resolveTheme(state);

    const setTheme = useCallback((preference: ThemePreference) => update({ preference }), []);
    const toggleTheme = useCallback(() => {
        update({ preference: resolveTheme(getSnapshot()) === 'dark' ? 'light' : 'dark' });
    }, []);
    const setPalette = useCallback((palette: PaletteId) => update({ palette }), []);
    const setGlass = useCallback((glass: GlassStyleId) => update({ glass }), []);
    const setMotion = useCallback((motion: MotionPreference) => update({ motion }), []);

    return {
        theme,
        preference: state.preference,
        palette: state.palette,
        glass: state.glass,
        motion: state.motion,
        mounted,
        setTheme,
        toggleTheme,
        setPalette,
        setGlass,
        setMotion,
    };
}
