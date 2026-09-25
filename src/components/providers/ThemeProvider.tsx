'use client';

import { createContext, useContext } from 'react';
import { MotionConfig } from 'framer-motion';
import { useTheme, COLOR_PALETTES } from '@/hooks/useTheme';
import type { PaletteId, ThemePreference } from '@/hooks/useTheme';

type ThemeContextType = ReturnType<typeof useTheme>;

const ThemeContext = createContext<ThemeContextType | null>(null);

export function useThemeContext() {
    const ctx = useContext(ThemeContext);
    if (!ctx) throw new Error('useThemeContext must be used within ThemeProvider');
    return ctx;
}

/**
 * Theme attributes are applied before first paint by the inline bootstrap
 * script in app/layout.tsx, so nothing here needs to hide the UI.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
    const themeValues = useTheme();

    return (
        <ThemeContext.Provider value={themeValues}>
            <MotionConfig reducedMotion="user" transition={{ type: 'spring', stiffness: 380, damping: 34 }}>
                {children}
            </MotionConfig>
        </ThemeContext.Provider>
    );
}

export { COLOR_PALETTES };
export type { PaletteId, ThemePreference };
