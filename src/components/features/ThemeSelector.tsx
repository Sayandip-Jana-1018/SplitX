'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Check, Monitor, Moon, Palette, Sun } from 'lucide-react';
import { useThemeContext, COLOR_PALETTES } from '@/components/providers/ThemeProvider';
import type { PaletteId, ThemePreference } from '@/components/providers/ThemeProvider';
import { IconButton, Segmented } from '@/components/ui/kit';
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

/** Compact theme controls for public pages (landing, auth). */
export default function ThemeSelector() {
    const { theme, palette, toggleTheme, setPalette } = useThemeContext();
    const [open, setOpen] = useState(false);

    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <IconButton
                label="Toggle dark/light mode"
                onClick={toggleTheme}
                icon={theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
            />
            <IconButton label="Choose color palette" onClick={() => setOpen(true)} icon={<Palette size={17} />} />

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
        </div>
    );
}
