/**
 * The person's look: light or dark, one of 16 colours, a kind of glass, and full or calm motion.
 * Saved on the phone; Reduce Motion in the system settings always means calm.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AccessibilityInfo, useColorScheme } from 'react-native';
import { DEFAULT_GLASS_PALETTE, glassPalette, isGlassPalette, type GlassMode, type GlassPalette, type PaletteId } from '@shared/glass/palette';
import { GLASS_STYLE_IDS, type GlassStyleId } from '@shared/glass/styles';
import { tokensFor, type Tokens } from './tokens';

export type ModePreference = 'system' | 'light' | 'dark';
export type MotionPreference = 'full' | 'calm';

interface Look {
    preference: ModePreference;
    mode: GlassMode;
    paletteId: PaletteId;
    glassStyle: GlassStyleId;
    motion: MotionPreference;
    /** Calm by choice, or because the system asks for reduced motion. */
    calm: boolean;
    tokens: Tokens;
    /** What the shaders paint with. */
    pal: GlassPalette;
    setPreference: (value: ModePreference) => void;
    setPalette: (value: PaletteId) => void;
    setGlassStyle: (value: GlassStyleId) => void;
    setMotion: (value: MotionPreference) => void;
}

const KEYS = {
    preference: 'splitit:theme',
    palette: 'splitit:palette',
    glass: 'splitit:glass',
    motion: 'splitit:motion',
} as const;

const LookContext = createContext<Look | null>(null);

function remember(key: string, value: string) {
    AsyncStorage.setItem(key, value).catch(() => undefined);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
    const system = useColorScheme();
    const [preference, setPreferenceState] = useState<ModePreference>('system');
    const [paletteId, setPaletteState] = useState<PaletteId>(DEFAULT_GLASS_PALETTE);
    const [glassStyle, setGlassState] = useState<GlassStyleId>('liquid');
    const [motion, setMotionState] = useState<MotionPreference>('full');
    const [reduceMotion, setReduceMotion] = useState(false);

    useEffect(() => {
        AsyncStorage.multiGet(Object.values(KEYS))
            .then((pairs) => {
                const saved = Object.fromEntries(pairs);
                const savedMode = saved[KEYS.preference];
                if (savedMode === 'light' || savedMode === 'dark' || savedMode === 'system') setPreferenceState(savedMode);
                if (isGlassPalette(saved[KEYS.palette])) setPaletteState(saved[KEYS.palette] as PaletteId);
                const savedGlass = saved[KEYS.glass];
                if (savedGlass && (GLASS_STYLE_IDS as readonly string[]).includes(savedGlass)) setGlassState(savedGlass as GlassStyleId);
                if (saved[KEYS.motion] === 'calm') setMotionState('calm');
            })
            .catch(() => undefined);
        AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => undefined);
        const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
        return () => subscription.remove();
    }, []);

    const mode: GlassMode = preference === 'system' ? (system === 'light' ? 'light' : 'dark') : preference;
    const value = useMemo<Look>(
        () => ({
            preference,
            mode,
            paletteId,
            glassStyle,
            motion,
            calm: motion === 'calm' || reduceMotion,
            tokens: tokensFor(paletteId, mode),
            pal: glassPalette(paletteId, mode),
            setPreference: (next) => {
                setPreferenceState(next);
                remember(KEYS.preference, next);
            },
            setPalette: (next) => {
                setPaletteState(next);
                remember(KEYS.palette, next);
            },
            setGlassStyle: (next) => {
                setGlassState(next);
                remember(KEYS.glass, next);
            },
            setMotion: (next) => {
                setMotionState(next);
                remember(KEYS.motion, next);
            },
        }),
        [preference, mode, paletteId, glassStyle, motion, reduceMotion],
    );
    return <LookContext.Provider value={value}>{children}</LookContext.Provider>;
}

export function useLook(): Look {
    const look = useContext(LookContext);
    if (!look) throw new Error('useLook needs ThemeProvider above it');
    return look;
}
