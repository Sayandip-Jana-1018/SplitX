'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { GLASS_LABELS } from '@/lib/glass/styles';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useThemeContext, COLOR_PALETTES } from '@/components/providers/ThemeProvider';
import type { PaletteId, ThemePreference } from '@/components/providers/ThemeProvider';
import { GlassPicker, Segmented } from '@/components/ui/kit';
import Modal from '@/components/ui/Modal';
import styles from './theme.module.css';

/** Four even rows of colour, each a little drop of it. */
function PalettePicker({ value, onChange }: { value: PaletteId; onChange: (id: PaletteId) => void }) {
    return (
        <div className={styles.paletteGrid} role="radiogroup" aria-label="Colour">
            {COLOR_PALETTES.map((palette) => (
                <button
                    key={palette.id}
                    type="button"
                    role="radio"
                    aria-checked={palette.id === value}
                    className={styles.paletteItem}
                    onClick={() => onChange(palette.id)}
                >
                    <span
                        className={styles.swatch}
                        style={{ background: `radial-gradient(circle at 34% 28%, ${palette.swatches[0]}, ${palette.swatches[1]} 52%, ${palette.swatches[2]})` }}
                    />
                    <span className={styles.swatchName}>{palette.name}</span>
                </button>
            ))}
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
    const { palette, setPalette, glass, motion: motionChoice, setMotion } = useThemeContext();
    const current = COLOR_PALETTES.find((entry) => entry.id === palette) ?? COLOR_PALETTES[0];
    const calm = motionChoice === 'calm';
    return (
        <div className={styles.stack}>
            <div className={styles.controls}>
                <div className={styles.preview} aria-hidden="true">
                    <i data-drop className={styles.previewDrop} />
                    <span className={styles.previewName}>{current.name}</span>
                    <span className={styles.previewGlass}>{GLASS_LABELS[glass].name} glass</span>
                </div>

                <div className={styles.modeArea}>
                    <ThemeModeSwitch />
                </div>

                <section className={styles.glassArea}>
                    <h4 className={styles.stackLabel}>Kind of glass</h4>
                    <GlassPicker />
                    <p className={styles.stackHint}>{GLASS_LABELS[glass].hint}</p>
                </section>

                <section className={styles.colourArea}>
                    <h4 className={styles.stackLabel}>Your colour</h4>
                    <div className={styles.paletteCard} data-glass="reg">
                        <PalettePicker value={palette} onChange={setPalette} />
                    </div>
                </section>

                <label className={styles.calmRow}>
                    <span className={styles.calmText}>Calm motion</span>
                    <button
                        type="button"
                        role="switch"
                        aria-checked={calm}
                        aria-label="Calm motion"
                        className={styles.toggle}
                        onClick={() => setMotion(calm ? 'full' : 'calm')}
                    />
                </label>
            </div>
        </div>
    );
}

/**
 * One tap opens everything about how SplitX looks.
 * The button itself previews the palette you're on.
 */
export default function ThemeSelector({ size = 44 }: { size?: number }) {
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
                size="wide"
            >
                <AppearanceControls />
            </Modal>
        </>
    );
}
