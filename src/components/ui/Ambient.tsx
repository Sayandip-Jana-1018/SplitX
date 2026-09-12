'use client';

import { useMemo } from 'react';
import { usePerformanceMode } from '@/hooks/usePerformanceMode';
import { cn } from '@/lib/utils';
import styles from './ambient.module.css';

export type AmbientVariant = 'hero' | 'page' | 'subtle';

interface GlyphSpec {
    emoji: string;
    /** percentage positions */
    x: number;
    y: number;
    size: number;
    duration: number;
    delay: number;
    tilt: number;
    /** when set, the glyph slowly orbits this radius instead of bobbing */
    orbit?: number;
}

const EXPENSE_GLYPHS: GlyphSpec[] = [
    { emoji: '💸', x: 8, y: 18, size: 52, duration: 14, delay: 0, tilt: -8 },
    { emoji: '🧾', x: 86, y: 12, size: 44, duration: 17, delay: 1.4, tilt: 7 },
    { emoji: '🍕', x: 12, y: 72, size: 46, duration: 16, delay: 0.8, tilt: 6 },
    { emoji: '✈️', x: 82, y: 66, size: 50, duration: 19, delay: 2.2, tilt: -5 },
    { emoji: '☕', x: 50, y: 88, size: 38, duration: 13, delay: 1.1, tilt: 9 },
    { emoji: '🎬', x: 92, y: 40, size: 36, duration: 21, delay: 0.4, tilt: -7 },
];

const ORBIT_GLYPHS: GlyphSpec[] = [
    { emoji: '🪙', x: 50, y: 32, size: 34, duration: 34, delay: 0, tilt: 0, orbit: 168 },
    { emoji: '🏷️', x: 50, y: 32, size: 30, duration: 46, delay: -12, tilt: 0, orbit: 232 },
];

/**
 * The colour and motion that sits behind a page: drifting accent fields, a
 * faint mesh, and a few glass glyphs that bob or orbit. Purely decorative —
 * it never intercepts pointer events, and it steps aside in calm mode.
 */
export default function Ambient({
    variant = 'page',
    glyphs = true,
    orbits = false,
    className,
}: {
    variant?: AmbientVariant;
    glyphs?: boolean;
    orbits?: boolean;
    className?: string;
}) {
    const { mode } = usePerformanceMode();

    const floating = useMemo(() => {
        if (!glyphs || mode === 'calm') return [];
        return variant === 'hero' ? EXPENSE_GLYPHS : EXPENSE_GLYPHS.slice(0, 3);
    }, [glyphs, mode, variant]);

    if (mode === 'calm') {
        return (
            <div className={cn(styles.field, styles[variant], className)} aria-hidden="true">
                <span className={cn(styles.blob, styles.blobA)} style={{ animation: 'none' }} />
            </div>
        );
    }

    return (
        <div className={cn(styles.field, styles[variant], className)} aria-hidden="true">
            <span className={cn(styles.blob, styles.blobA)} />
            <span className={cn(styles.blob, styles.blobB)} />
            {variant === 'hero' && <span className={cn(styles.blob, styles.blobC)} />}
            <span className={styles.mesh} />

            {floating.map((glyph) => (
                <span
                    key={glyph.emoji}
                    className={styles.glyph}
                    style={{
                        left: `${glyph.x}%`,
                        top: `${glyph.y}%`,
                        ['--size' as string]: `${glyph.size}px`,
                        ['--dur' as string]: `${glyph.duration}s`,
                        ['--delay' as string]: `${glyph.delay}s`,
                        ['--tilt' as string]: `${glyph.tilt}deg`,
                    }}
                >
                    {glyph.emoji}
                </span>
            ))}

            {orbits && mode === 'premium' && ORBIT_GLYPHS.map((glyph) => (
                <span
                    key={glyph.emoji}
                    className={styles.orbit}
                    style={{
                        left: `${glyph.x}%`,
                        top: `${glyph.y}%`,
                        ['--radius' as string]: `${glyph.orbit}px`,
                        ['--dur' as string]: `${glyph.duration}s`,
                        ['--delay' as string]: `${glyph.delay}s`,
                    }}
                >
                    <span
                        className={styles.glyph}
                        style={{
                            position: 'static',
                            ['--size' as string]: `${glyph.size}px`,
                            ['--dur' as string]: `${glyph.duration / 2}s`,
                        }}
                    >
                        {glyph.emoji}
                    </span>
                </span>
            ))}
        </div>
    );
}
