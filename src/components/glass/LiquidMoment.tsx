'use client';

import { useEffect, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import styles from './moment.module.css';

/**
 * A short moment of liquid between two screens: the page steps back, one drop
 * parts into a drop for each person, and `onDone` carries on. The engine draws the
 * drops; words sit over them. Calm and Reduced Motion skip straight to `onDone`.
 */
export function LiquidMoment({ value, title, parts, onDone }: {
    value: ReactNode;
    title: ReactNode;
    /** How many drops it parts into, at most six. */
    parts: number;
    onDone: () => void;
}) {
    useEffect(() => {
        const html = document.documentElement;
        const still = html.getAttribute('data-motion') === 'calm' || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (still) {
            onDone();
            return;
        }
        html.setAttribute('data-moment', '');
        const timer = window.setTimeout(onDone, MOMENT_MS);
        return () => {
            window.clearTimeout(timer);
            html.removeAttribute('data-moment');
        };
    }, [onDone]);

    const count = Math.max(2, Math.min(6, parts));
    return createPortal(
        <div className={styles.moment} role="status" aria-live="polite">
            {Array.from({ length: count }, (_, index) => {
                const angle = (index / count) * Math.PI * 2 - Math.PI / 2;
                const style = { '--dx': `${Math.cos(angle) * 120}px`, '--dy': `${Math.sin(angle) * 150}px` } as CSSProperties;
                return <i key={index} data-drop className={styles.part} style={style} />;
            })}
            <i data-drop className={styles.heart} />
            <p className={styles.value}>{value}</p>
            <p className={styles.title}>{title}</p>
        </div>,
        document.body,
    );
}

const MOMENT_MS = 1700;
