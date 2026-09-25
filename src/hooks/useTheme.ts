'use client';

import { useCallback, useSyncExternalStore } from 'react';

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export type PaletteId =
    | 'amethyst-haze' | 'cosmic-night' | 'bold-tech' | 'sky-blue' | 'ocean-breeze'
    | 'perpetuity' | 'emerald-glow' | 'lime-fusion' | 'amber-minimal' | 'solar-dusk'
    | 'cherry-blossom' | 'quantum-rose' | 'cyberpunk'
    | 'copper-glow' | 'graphite-mono' | 'merlot-night';

export interface ColorPalette {
    id: PaletteId;
    name: string;
    accent400: string;
    accent500: string;
    accent600: string;
    accent500rgb: string;
    swatches: string[];
}

const THEME_STORAGE_KEY = 'SplitX-theme';
const PALETTE_STORAGE_KEY = 'SplitX-palette';
const DEFAULT_PALETTE: PaletteId = 'amethyst-haze';

/** Curated palette set. Full colour scales live in styles/themes/accents.css. */
export const COLOR_PALETTES: ColorPalette[] = [
    { id: 'amethyst-haze', name: 'Amethyst', accent400: '#a78bfa', accent500: '#8b5cf6', accent600: '#7c3aed', accent500rgb: '139, 92, 246', swatches: ['#c4b5fd', '#8b5cf6', '#6d28d9'] },
    { id: 'cosmic-night', name: 'Indigo', accent400: '#818cf8', accent500: '#6366f1', accent600: '#4f46e5', accent500rgb: '99, 102, 241', swatches: ['#a5b4fc', '#6366f1', '#4338ca'] },
    { id: 'bold-tech', name: 'Cobalt', accent400: '#60a5fa', accent500: '#3b82f6', accent600: '#2563eb', accent500rgb: '59, 130, 246', swatches: ['#93c5fd', '#3b82f6', '#1d4ed8'] },
    { id: 'sky-blue', name: 'Sky', accent400: '#38bdf8', accent500: '#0ea5e9', accent600: '#0284c7', accent500rgb: '14, 165, 233', swatches: ['#7dd3fc', '#0ea5e9', '#0369a1'] },
    { id: 'ocean-breeze', name: 'Lagoon', accent400: '#22d3ee', accent500: '#06b6d4', accent600: '#0891b2', accent500rgb: '6, 182, 212', swatches: ['#67e8f9', '#06b6d4', '#0e7490'] },
    { id: 'perpetuity', name: 'Teal', accent400: '#2dd4bf', accent500: '#14b8a6', accent600: '#0d9488', accent500rgb: '20, 184, 166', swatches: ['#5eead4', '#14b8a6', '#0f766e'] },
    { id: 'emerald-glow', name: 'Emerald', accent400: '#34d399', accent500: '#10b981', accent600: '#059669', accent500rgb: '16, 185, 129', swatches: ['#6ee7b7', '#10b981', '#047857'] },
    { id: 'lime-fusion', name: 'Lime', accent400: '#a3e635', accent500: '#84cc16', accent600: '#65a30d', accent500rgb: '132, 204, 22', swatches: ['#bef264', '#84cc16', '#4d7c0f'] },
    { id: 'amber-minimal', name: 'Amber', accent400: '#fbbf24', accent500: '#f59e0b', accent600: '#d97706', accent500rgb: '245, 158, 11', swatches: ['#fcd34d', '#f59e0b', '#b45309'] },
    { id: 'solar-dusk', name: 'Sunset', accent400: '#fb923c', accent500: '#f97316', accent600: '#ea580c', accent500rgb: '249, 115, 22', swatches: ['#fdba74', '#f97316', '#c2410c'] },
    { id: 'cherry-blossom', name: 'Rose', accent400: '#fb7185', accent500: '#f43f5e', accent600: '#e11d48', accent500rgb: '244, 63, 94', swatches: ['#fda4af', '#f43f5e', '#be123c'] },
    { id: 'quantum-rose', name: 'Blush', accent400: '#f472b6', accent500: '#ec4899', accent600: '#db2777', accent500rgb: '236, 72, 153', swatches: ['#f9a8d4', '#ec4899', '#be185d'] },
    { id: 'cyberpunk', name: 'Orchid', accent400: '#e879f9', accent500: '#d946ef', accent600: '#c026d3', accent500rgb: '217, 70, 239', swatches: ['#f0abfc', '#d946ef', '#a21caf'] },
    { id: 'copper-glow', name: 'Copper', accent400: '#d6824f', accent500: '#c06835', accent600: '#a2522a', accent500rgb: '192, 104, 53', swatches: ['#e4a578', '#c06835', '#833f24'] },
    { id: 'merlot-night', name: 'Merlot', accent400: '#dc6188', accent500: '#c23a67', accent600: '#a62851', accent500rgb: '194, 58, 103', swatches: ['#ec97b0', '#c23a67', '#8a1e42'] },
    { id: 'graphite-mono', name: 'Graphite', accent400: '#8b95a7', accent500: '#66718a', accent600: '#515a70', accent500rgb: '102, 113, 138', swatches: ['#b6bdca', '#66718a', '#43495b'] },
];

const LEGACY_PALETTES: Record<string, PaletteId> = {
    'pastel-dreams': 'amethyst-haze',
    'lavender-mist': 'amethyst-haze',
    'midnight-indigo': 'cosmic-night',
    tangerine: 'solar-dusk',
    'warm-coral': 'cherry-blossom',
};

const THEME_COLORS: Record<ResolvedTheme, string> = {
    light: '#f4f5f8',
    dark: '#0a0a0e',
};

function normalizePalette(value: string | null): PaletteId {
    if (!value) return DEFAULT_PALETTE;
    if (COLOR_PALETTES.some((palette) => palette.id === value)) return value as PaletteId;
    return LEGACY_PALETTES[value] ?? DEFAULT_PALETTE;
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
    systemDark: boolean;
}

const SERVER_STATE: ThemeState = { preference: 'system', palette: DEFAULT_PALETTE, systemDark: true };
const listeners = new Set<() => void>();
let current: ThemeState | null = null;

function readState(): ThemeState {
    let preference: ThemePreference = 'system';
    let palette: PaletteId = DEFAULT_PALETTE;
    try {
        preference = normalizePreference(localStorage.getItem(THEME_STORAGE_KEY));
        palette = normalizePalette(localStorage.getItem(PALETTE_STORAGE_KEY));
    } catch {
        // storage unavailable (private mode) — fall back to defaults
    }
    const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    return { preference, palette, systemDark };
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
    root.style.colorScheme = resolved;

    // Clean up inline overrides written by older builds
    for (const prop of ['--accent-300', '--accent-400', '--accent-500', '--accent-600', '--accent-500-rgb']) {
        root.style.removeProperty(prop);
    }

    document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
        meta.setAttribute('content', THEME_COLORS[resolved]);
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
        if (event.key !== THEME_STORAGE_KEY && event.key !== PALETTE_STORAGE_KEY) return;
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

    return {
        theme,
        preference: state.preference,
        palette: state.palette,
        mounted,
        setTheme,
        toggleTheme,
        setPalette,
    };
}
