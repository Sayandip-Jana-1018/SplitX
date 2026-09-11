import { Split } from 'lucide-react';
import { cn } from '@/lib/utils';
import styles from './brand.module.css';

interface BrandMarkProps {
    size?: number;
    wordmark?: boolean;
    className?: string;
}

/** SplitX logo lockup — gradient mark + wordmark. Inherits the active palette. */
export default function BrandMark({ size = 30, wordmark = true, className }: BrandMarkProps) {
    return (
        <span className={cn(styles.brand, className)}>
            <span
                className={styles.mark}
                style={{ width: size, height: size, borderRadius: Math.round(size * 0.32) }}
                aria-hidden="true"
            >
                <Split size={Math.round(size * 0.54)} strokeWidth={2.5} />
            </span>
            {wordmark && (
                <span className={styles.word} style={{ fontSize: Math.max(15, Math.round(size * 0.6)) }}>
                    Split<span className={styles.x}>X</span>
                </span>
            )}
        </span>
    );
}
