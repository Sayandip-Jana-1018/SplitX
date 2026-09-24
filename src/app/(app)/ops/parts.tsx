import type { Reading } from '@/lib/ops/reading';
import styles from './ops.module.css';

/** Where every panel's code lives; each panel links to what produces it. */
export const REPOSITORY_URL = 'https://github.com/Sayandip-Jana-1018/SplitX';

export const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** Where a panel's numbers came from, and when; or why they aren't there. */
export function Source({ reading }: { reading: Reading<unknown> }) {
    return (
        <span className={styles.meta}>
            {reading.source} · read {clock(reading.fetchedAt)}
        </span>
    );
}

export function Unavailable({ reading }: { reading: Reading<unknown> }) {
    if (reading.ok) return null;
    return <p className={styles.unavailable}>Unavailable: {reading.error}.</p>;
}

/** A link to the file in the repository that produces a panel. */
export function CodeLink({ path, children = 'the code' }: { path: string; children?: string }) {
    return (
        <a className={styles.link} href={`${REPOSITORY_URL}/blob/main/${path}`} target="_blank" rel="noreferrer">
            {children}
        </a>
    );
}
