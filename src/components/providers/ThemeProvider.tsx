'use client';

import { createContext, useContext } from 'react';
import { useTheme, COLOR_PALETTES } from '@/hooks/useTheme';
import type { PaletteId, ColorPalette } from '@/hooks/useTheme';

type ThemeContextType = ReturnType<typeof useTheme>;

const ThemeContext = createContext<ThemeContextType | null>(null);

export function useThemeContext() {
    const ctx = useContext(ThemeContext);
    if (!ctx) throw new Error('useThemeContext must be used within ThemeProvider');
    return ctx;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
    const themeValues = useTheme();

    return (
        <ThemeContext.Provider value={themeValues}>
            <div style={themeValues.mounted ? undefined : { visibility: 'hidden' }}>
                {children}
            </div>
        </ThemeContext.Provider>
    );
}

// Re-export for consumers
export { COLOR_PALETTES };
export type { PaletteId, ColorPalette };
