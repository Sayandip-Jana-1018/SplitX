import { useId } from 'react';
import { cn } from '@/lib/utils';
import styles from './brand.module.css';

interface BrandMarkProps {
    size?: number;
    wordmark?: boolean;
    className?: string;
}

/**
 * SplitIT's logo: a coin of liquid glass. Its gold rim and rupee stay the same everywhere,
 * so it is always recognisably ours; its face and liquid take the active palette.
 * The installed app's icon is the same coin (public/icons), in the default colour.
 */
export default function BrandMark({ size = 30, wordmark = true, className }: BrandMarkProps) {
    const id = useId();
    return (
        <span className={cn(styles.brand, className)}>
            <svg width={size} height={size} viewBox="42 42 428 428" className={styles.mark} aria-hidden="true">
                <defs>
                    <linearGradient id={`${id}rim`} x1="0.1" y1="0" x2="0.9" y2="1">
                        <stop offset="0" className={styles.coin1} />
                        <stop offset="0.4" className={styles.coin2} />
                        <stop offset="0.72" className={styles.coin3} />
                        <stop offset="1" className={styles.coin4} />
                    </linearGradient>
                    <linearGradient id={`${id}glyph`} x1="0.2" y1="0" x2="0.8" y2="1">
                        <stop offset="0" className={styles.coin1} />
                        <stop offset="1" className={styles.coin2} />
                    </linearGradient>
                    <linearGradient id={`${id}liquid`} x1="0.25" y1="0.25" x2="0.8" y2="1">
                        <stop offset="0" className={styles.liquid1} />
                        <stop offset="1" className={styles.liquid2} />
                    </linearGradient>
                    <clipPath id={`${id}face`}><circle cx="256" cy="256" r="150" /></clipPath>
                </defs>
                <circle cx="256" cy="256" r="186" fill={`url(#${id}rim)`} />
                <circle cx="256" cy="256" r="150" className={styles.face} />
                <g clipPath={`url(#${id}face)`}>
                    <path d={`${WAVE} L426 440 L86 440 Z`} fill={`url(#${id}liquid)`} />
                    <path d={WAVE} fill="none" className={styles.surface} strokeWidth="8" />
                </g>
                <path d={RUPEE} fill="none" stroke={`url(#${id}glyph)`} strokeWidth="32" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {wordmark && (
                <span className={styles.word} style={{ fontSize: Math.max(15, Math.round(size * 0.6)) }}>
                    Split<span className={styles.it}>IT</span>
                </span>
            )}
        </span>
    );
}

const WAVE = 'M86 306 C166 214 211 216 256 258 S346 322 426 214';
const RUPEE = 'M190 158 H322 M190 208 H322 M232 158 C276 158 298 180 298 208 C298 240 270 260 232 260 H194 L294 368';
