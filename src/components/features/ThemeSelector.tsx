'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Check, Monitor, Moon, Sun } from 'lucide-react';
import { useThemeContext, COLOR_PALETTES } from '@/components/providers/ThemeProvider';
import type { PaletteId, ThemePreference } from '@/components/providers/ThemeProvider';
import { GlassPicker, Segmented } from '@/components/ui/kit';
import Modal from '@/components/ui/Modal';
import { cn } from '@/lib/utils';
import styles from './theme.module.css';

/** Grid of accent swatches. */
function PalettePicker({ value, onChange, className }: { value: PaletteId; onChange: (id: PaletteId) => void; className?: string }) {
    return (
        <div className={cn(styles.paletteGrid, className)} role="radiogroup" aria-label="Accent colour">
            {COLOR_PALETTES.map((palette) => {
                const active = palette.id === value;
                return (
                    <button
                        key={palette.id}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        className={styles.paletteItem}
                        onClick={() => onChange(palette.id)}
                    >
                        <span
                            className={styles.swatch}
                            style={{
                                background: `conic-gradient(from 210deg, ${palette.swatches[0]}, ${palette.swatches[1]}, ${palette.swatches[2]}, ${palette.swatches[0]})`,
                            }}
                        >
                            {active && (
                                <motion.span
                                    className={styles.swatchCheck}
                                    initial={{ scale: 0.4, opacity: 0 }}
                                    animate={{ scale: 1, opacity: 1 }}
                                    transition={{ type: 'spring', stiffness: 520, damping: 24 }}
                                >
                                    <Check size={13} strokeWidth={3} />
                                </motion.span>
                            )}
                        </span>
                        <span className={styles.swatchName}>{palette.name}</span>
                    </button>
                );
            })}
        </div>
    );
}

/** Light / Dark / Auto segmented switch bound to the theme store. */
function ThemeModeSwitch({ size = 'md' }: { size?: 'sm' | 'md' }) {
    const { preference, setTheme } = useThemeContext();
    return (
        <Segmented<ThemePreference>
            size={size}
            ariaLabel="Appearance"
            value={preference}
            onChange={setTheme}
            options={[
                { value: 'light', label: <span className={styles.modeLabel}><Sun size={14} />Light</span> },
                { value: 'dark', label: <span className={styles.modeLabel}><Moon size={14} />Dark</span> },
                { value: 'system', label: <span className={styles.modeLabel}><Monitor size={14} />Auto</span> },
            ]}
        />
    );
}

/** Everything about how SplitX looks, in Settings and behind the appearance button alike. */
export function AppearanceControls() {
    const { palette, setPalette, motion, setMotion } = useThemeContext();
    return (
        <div className={styles.stack}>
            <div>
                <div className={styles.stackLabel}>Kind of glass</div>
                <GlassPicker />
            </div>
            <div>
                <div className={styles.stackLabel}>Colour</div>
                <PalettePicker value={palette} onChange={setPalette} />
            </div>
            <div>
                <div className={styles.stackLabel}>Mode</div>
                <ThemeModeSwitch />
            </div>
            <div>
                <div className={styles.stackLabel}>Motion</div>
                <Segmented
                    ariaLabel="Motion"
                    value={motion}
                    onChange={setMotion}
                    options={[
                        { value: 'full', label: 'Full' },
                        { value: 'calm', label: 'Calm' },
                    ]}
                />
                <p className={styles.stackHint}>
                    {motion === 'calm' ? 'A still picture of the liquid, and less for your battery to do.' : 'The liquid keeps floating behind the glass.'}
                </p>
            </div>
        </div>
    );
}

/**
 * One tap opens everything about how SplitX looks.
 * The button itself previews the palette you're on.
 */
export default function ThemeSelector({ size = 40 }: { size?: number }) {
    const { theme, palette } = useThemeContext();
    const [open, setOpen] = useState(false);
    const current = COLOR_PALETTES.find((entry) => entry.id === palette) ?? COLOR_PALETTES[0];

    return (
        <>
            <motion.button
                type="button"
                className={styles.appearanceButton}
                style={{ width: size, height: size }}
                onClick={() => setOpen(true)}
                whileTap={{ scale: 0.9 }}
                data-glass="thin"
                aria-label="Appearance — glass, colour and mode"
                title="Appearance"
            >
                <span
                    className={styles.appearanceDisc}
                    style={{
                        background: `conic-gradient(from 210deg, ${current.swatches[0]}, ${current.swatches[1]}, ${current.swatches[2]}, ${current.swatches[0]})`,
                    }}
                />
                <span className={styles.appearanceGlyph}>
                    {theme === 'dark' ? <Moon size={12} strokeWidth={2.6} /> : <Sun size={12} strokeWidth={2.6} />}
                </span>
            </motion.button>

            <Modal
                isOpen={open}
                onClose={() => setOpen(false)}
                title="Appearance"
                description="Make SplitX feel like yours."
                size="small"
            >
                <AppearanceControls />
            </Modal>
        </>
    );
}
