import type { ReactNode } from 'react';
import { ArrowUpRight } from 'lucide-react';
import type { Reading } from '@/lib/ops/reading';
import styles from './ops.module.css';

/** Where every panel's code lives; each panel links to what produces it. */
export const REPOSITORY_URL = 'https://github.com/Sayandip-Jana-1018/SplitX';

export const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** The separator in small print: it stays at the end of a line, never starts one. */
export const SEP = ' · ';

/** Where a panel's numbers came from, and when; or why they aren't there. */
export function Source({ reading }: Readonly<{ reading: Reading<unknown> }>) {
    return (
        <span className={styles.meta}>{reading.source}{SEP}read {clock(reading.fetchedAt)}</span>
    );
}

/** The small print under a panel or a section: its source, its code, a reason. Centred, like the page. */
export function Footnote({ children }: Readonly<{ children: ReactNode }>) {
    return <p className={styles.footnote}>{children}</p>;
}

export function Unavailable({ reading }: Readonly<{ reading: Reading<unknown> }>) {
    if (reading.ok) return null;
    return <p className={styles.unavailable}>Unavailable: {reading.error}.</p>;
}

/** A link to the file in the repository that produces a panel. */
export function CodeLink({ path, children = 'the code' }: Readonly<{ path: string; children?: string }>) {
    return (
        <a className={styles.link} href={`${REPOSITORY_URL}/blob/main/${path}`} target="_blank" rel="noreferrer">
            {children}
        </a>
    );
}

/** A way out to the tool itself, as a pill: the Security tab, the runs, Grafana. */
export function OutLink({ href, children }: Readonly<{ href: string; children: string }>) {
    return (
        <a className={styles.outLink} href={href} target="_blank" rel="noreferrer">
            {children}
            <ArrowUpRight size={14} aria-hidden />
        </a>
    );
}
