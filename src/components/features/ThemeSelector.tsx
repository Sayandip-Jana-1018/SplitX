'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Check, Monitor, Moon, Sun } from 'lucide-react';
import { useThemeContext, COLOR_PALETTES } from '@/components/providers/ThemeProvider';
import type { PaletteId, ThemePreference } from '@/components/providers/ThemeProvider';
import { Segmented } from '@/components/ui/kit';
import Modal from '@/components/ui/Modal';
import styles from './theme.module.css';

/** Grid of accent swatches. */
export function PalettePicker({ value, onChange }: { value: PaletteId; onChange: (id: PaletteId) => void }) {
    return (
        <div className={styles.paletteGrid} role="radiogroup" aria-label="Accent colour">
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
                                background: `conic-gradient(from 210deg, ${palette.swatches[0]}, ${palette.accent500}, ${palette.swatches[2]}, ${palette.swatches[0]})`,
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
export function ThemeModeSwitch({ size = 'md' }: { size?: 'sm' | 'md' }) {
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

/**
 * One tap opens everything about how SplitX looks: mode + accent.
 * The button itself previews the palette you're on.
 */
export default function ThemeSelector({ size = 40 }: { size?: number }) {
    const { theme, palette, setPalette } = useThemeContext();
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
                aria-label="Appearance — theme and accent colour"
                title="Appearance"
            >
                <motion.span
                    className={styles.appearanceDisc}
                    style={{
                        background: `conic-gradient(from 210deg, ${current.swatches[0]}, ${current.accent500}, ${current.swatches[2]}, ${current.swatches[0]})`,
                    }}
                    animate={{ rotate: 360 }}
                    transition={{ duration: 16, repeat: Infinity, ease: 'linear' }}
                />
                <motion.span
                    className={styles.appearanceGlyph}
                    animate={{ scale: [1, 1.12, 1] }}
                    transition={{ duration: 3.4, repeat: Infinity, ease: 'easeInOut' }}
                >
                    {theme === 'dark' ? <Moon size={12} strokeWidth={2.6} /> : <Sun size={12} strokeWidth={2.6} />}
                </motion.span>
            </motion.button>

            <Modal
                isOpen={open}
                onClose={() => setOpen(false)}
                title="Appearance"
                description="Make SplitX feel like yours."
                size="small"
            >
                <div className={styles.stack}>
                    <div>
                        <div className={styles.stackLabel}>Mode</div>
                        <ThemeModeSwitch />
                    </div>
                    <div>
                        <div className={styles.stackLabel}>Accent colour</div>
                        <PalettePicker value={palette} onChange={setPalette} />
                    </div>
                </div>
            </Modal>
        </>
    );
}
