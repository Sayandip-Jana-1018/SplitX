'use client';

import { useState, useEffect, useCallback } from 'react';

type Theme = 'light' | 'dark';

export type PaletteId =
    | 'amethyst-haze' | 'cosmic-night' | 'quantum-rose'
    | 'emerald-glow' | 'ocean-breeze' | 'solar-dusk'
    | 'bold-tech' | 'amber-minimal' | 'perpetuity'
    | 'tangerine' | 'pastel-dreams' | 'cyberpunk';

export interface ColorPalette {
    id: PaletteId;
    name: string;
    // CSS variable overrides for accent
    accent400: string;
    accent500: string;
    accent600: string;
    accent500rgb: string;
    // Preview swatch colors (for the pill UI)
    swatches: string[];
}

const THEME_KEY = 'autosplit-theme';
const PALETTE_KEY = 'autosplit-palette';

export const COLOR_PALETTES: ColorPalette[] = [
    {
        id: 'amethyst-haze',
        name: 'Amethyst Haze',
        accent400: '#a78bfa', accent500: '#8b5cf6', accent600: '#7c3aed',
        accent500rgb: '139, 92, 246',
        swatches: ['#ddd6fe', '#a78bfa', '#7c3aed'],
    },
    {
        id: 'quantum-rose',
        name: 'Quantum Rose',
        accent400: '#f472b6', accent500: '#ec4899', accent600: '#db2777',
        accent500rgb: '236, 72, 153',
        swatches: ['#fbcfe8', '#f472b6', '#db2777'],
    },
    {
        id: 'cosmic-night',
        name: 'Cosmic Night',
        accent400: '#818cf8', accent500: '#6366f1', accent600: '#4f46e5',
        accent500rgb: '99, 102, 241',
        swatches: ['#c7d2fe', '#818cf8', '#4f46e5'],
    },
    {
        id: 'emerald-glow',
        name: 'Emerald Glow',
        accent400: '#34d399', accent500: '#10b981', accent600: '#059669',
        accent500rgb: '16, 185, 129',
        swatches: ['#a7f3d0', '#34d399', '#059669'],
    },
    {
        id: 'ocean-breeze',
        name: 'Ocean Breeze',
        accent400: '#22d3ee', accent500: '#06b6d4', accent600: '#0891b2',
        accent500rgb: '6, 182, 212',
        swatches: ['#a5f3fc', '#22d3ee', '#0891b2'],
    },
    {
        id: 'solar-dusk',
        name: 'Solar Dusk',
        accent400: '#fb923c', accent500: '#f97316', accent600: '#ea580c',
        accent500rgb: '249, 115, 22',
        swatches: ['#fed7aa', '#fb923c', '#ea580c'],
    },
    {
        id: 'bold-tech',
        name: 'Bold Tech',
        accent400: '#60a5fa', accent500: '#3b82f6', accent600: '#2563eb',
        accent500rgb: '59, 130, 246',
        swatches: ['#bfdbfe', '#60a5fa', '#2563eb'],
    },
    {
        id: 'amber-minimal',
        name: 'Amber Minimal',
        accent400: '#fbbf24', accent500: '#f59e0b', accent600: '#d97706',
        accent500rgb: '245, 158, 11',
        swatches: ['#fde68a', '#fbbf24', '#d97706'],
    },
    {
        id: 'tangerine',
        name: 'Tangerine',
        accent400: '#f87171', accent500: '#ef4444', accent600: '#dc2626',
        accent500rgb: '239, 68, 68',
        swatches: ['#fecaca', '#f87171', '#dc2626'],
    },
    {
        id: 'perpetuity',
        name: 'Perpetuity',
        accent400: '#2dd4bf', accent500: '#14b8a6', accent600: '#0d9488',
        accent500rgb: '20, 184, 166',
        swatches: ['#99f6e4', '#2dd4bf', '#0d9488'],
    },
    {
        id: 'pastel-dreams',
        name: 'Pastel Dreams',
        accent400: '#c084fc', accent500: '#a855f7', accent600: '#9333ea',
        accent500rgb: '168, 85, 247',
        swatches: ['#e9d5ff', '#c084fc', '#9333ea'],
    },
    {
        id: 'cyberpunk',
        name: 'Cyberpunk',
        accent400: '#e879f9', accent500: '#d946ef', accent600: '#c026d3',
        accent500rgb: '217, 70, 239',
        swatches: ['#f5d0fe', '#e879f9', '#c026d3'],
    },
];

export function useTheme() {
    const [theme, setThemeState] = useState<Theme>('dark');
    const [palette, setPaletteState] = useState<PaletteId>('amethyst-haze');
    const [mounted, setMounted] = useState(false);

    // Read from localStorage on mount
    useEffect(() => {
        const savedTheme = localStorage.getItem(THEME_KEY) as Theme | null;
        const savedPalette = localStorage.getItem(PALETTE_KEY) as PaletteId | null;

        if (savedTheme) {
            setThemeState(savedTheme);
        } else {
            const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            setThemeState(prefersDark ? 'dark' : 'light');
        }

        if (savedPalette) {
            setPaletteState(savedPalette);
        }

        setMounted(true);
    }, []);

    // Apply to document
    useEffect(() => {
        if (!mounted) return;

        const doc = document.documentElement;
        doc.setAttribute('data-theme', theme);
        doc.setAttribute('data-palette', palette);

        // Apply palette CSS variables directly
        const pal = COLOR_PALETTES.find(p => p.id === palette);
        if (pal) {
            doc.style.setProperty('--accent-300', pal.swatches[0]);
            doc.style.setProperty('--accent-400', pal.accent400);
            doc.style.setProperty('--accent-500', pal.accent500);
            doc.style.setProperty('--accent-600', pal.accent600);
            doc.style.setProperty('--accent-500-rgb', pal.accent500rgb);
        }

        localStorage.setItem(THEME_KEY, theme);
        localStorage.setItem(PALETTE_KEY, palette);

        // Set cookies for SSR
        document.cookie = `theme=${theme};path=/;max-age=31536000`;
        document.cookie = `palette=${palette};path=/;max-age=31536000`;
    }, [theme, palette, mounted]);

    const setTheme = useCallback((t: Theme) => {
        setThemeState(t);
    }, []);

    const toggleTheme = useCallback(() => {
        setThemeState((prev) => (prev === 'dark' ? 'light' : 'dark'));
    }, []);

    const setPalette = useCallback((p: PaletteId) => {
        setPaletteState(p);
    }, []);

    return {
        theme,
        palette,
        mounted,
        setTheme,
        toggleTheme,
        setPalette,
    };
}

// Keep backwards compat export
export const ACCENT_COLORS = COLOR_PALETTES.map(p => ({
    value: p.id,
    label: p.name,
    color: p.accent500,
}));
