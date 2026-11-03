'use client';

import { useCallback, useEffect, useState } from 'react';
import { Glass } from '@/components/glass/Glass';
import { COLOR_PALETTES, useThemeContext } from '@/components/providers/ThemeProvider';
import type { GlassCanvasMode, GlassStats } from '@/lib/glass/engine';
import { QUALITY } from '@/lib/glass/governor';
import { getGlassEngine } from '@/lib/glass/runtime';
import { GLASS_STYLE_IDS } from '@/lib/glass/styles';
import styles from './lab.module.css';

const OWES_YOU = [
    { who: 'Kabir owes you', initials: 'KK', where: 'Goa Trip', amount: '+₹5,325.87' },
    { who: 'Meera owes you', initials: 'MI', where: 'Goa Trip', amount: '+₹2,601.37' },
    { who: 'Ravi owes you', initials: 'RM', where: 'Goa Trip', amount: '+₹2,471.38' },
    { who: 'Ravi owes you', initials: 'RM', where: 'Flat 402', amount: '+₹16,246.25' },
];
const ACTIVITY = [
    { title: 'Biryani Friday', meta: 'Kabir paid · 1d ago', amount: '₹1,860', share: 'Your share ₹465' },
    { title: 'Beach shack dinner', meta: 'Ravi paid · 2d ago', amount: '₹4,280', share: 'Your share ₹1,070' },
    { title: 'Coffee run', meta: 'You paid · 3d ago', amount: '₹640', share: 'Your share ₹160' },
    { title: 'Scooter rental', meta: 'You paid · 3d ago', amount: '₹2,400', share: 'Your share ₹600' },
    { title: 'Parasailing', meta: 'Meera paid · 4d ago', amount: '₹6,000', share: 'Your share ₹1,500' },
];
const GROUPS = [
    { name: 'Ladakh 2026', meta: '5 members · ₹42,800', balance: '+₹740' },
    { name: 'Office Lunch', meta: '4 members · ₹3,620', balance: '−₹265' },
    { name: 'Goa Trip', meta: '4 members · ₹34,405', balance: '+₹10,398' },
    { name: 'Flat 402', meta: '3 members · ₹51,735', balance: '+₹31,651' },
];
const MORE = ['Balance journey', 'Spending insights', 'Ask SplitX AI', 'Receipts', 'Contacts', 'History'];
const NAV = ['Home', 'Groups', '+', 'Activity', 'Settle'];
const MODES: { id: GlassCanvasMode; label: string }[] = [
    { id: 'locked', label: 'Moves with page' },
    { id: 'fixed', label: 'Fixed (old way)' },
    { id: 'css', label: 'All CSS' },
];

interface BenchResult {
    name: string;
    fps: number;
    p95: number;
    worst: number;
    level: string;
    frames: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Scrolls the whole page down and back up, as a person would flick through it, for `seconds`. */
function scrollThrough(seconds: number): Promise<void> {
    return new Promise((resolve) => {
        const start = performance.now();
        const reach = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
        const step = (now: number) => {
            const p = (now - start) / (seconds * 1000);
            if (p >= 1) {
                window.scrollTo(0, 0);
                resolve();
                return;
            }
            window.scrollTo(0, reach * (0.5 - 0.5 * Math.cos(p * 2 * Math.PI * 2)));
            requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
    });
}

export default function GlassLab() {
    const { theme, palette, glass, motion, setTheme, setPalette, setGlass, setMotion } = useThemeContext();
    const [stats, setStats] = useState<GlassStats | null>(null);
    const [open, setOpen] = useState(false);
    const [mode, setMode] = useState<GlassCanvasMode>('locked');
    const [level, setLevel] = useState<number | null>(null);
    const [bench, setBench] = useState<BenchResult[] | null>(null);
    const [benching, setBenching] = useState(false);
    const [cost, setCost] = useState<{ liquidMs: number; screenMs: number } | null>(null);

    useEffect(() => {
        const poll = window.setInterval(() => {
            const engine = getGlassEngine();
            if (engine) setStats(engine.stats());
        }, 500);
        return () => window.clearInterval(poll);
    }, []);

    const ready = stats !== null;
    useEffect(() => {
        if (ready) getGlassEngine()?.setMode(mode);
    }, [mode, ready]);
    useEffect(() => {
        if (ready) getGlassEngine()?.setLevel(level);
    }, [level, ready]);

    const runBench = useCallback(async () => {
        const lab = getGlassEngine();
        if (!lab) return;
        setOpen(false);
        setBenching(true);
        const results: BenchResult[] = [];
        setCost(lab.measureCost());
        const measure = async (name: string, run: () => Promise<unknown>) => {
            lab.resetStats();
            await run();
            const s = lab.stats();
            results.push({ name, fps: Math.round(s.fps), p95: +s.p95Ms.toFixed(1), worst: +s.worstMs.toFixed(1), level: s.levelName, frames: s.frames });
        };
        await measure('Still, 6 s', () => sleep(6000));
        await measure('Scrolling, 12 s', () => scrollThrough(12));
        setBench(results);
        setBenching(false);
        setOpen(true);
    }, []);

    return (
        <div className={styles.page}>
            <Glass as="header" kind="thin" floats className={styles.bar}>
                <button type="button" className={styles.hud} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
                    {stats ? `${Math.round(stats.fps)} fps · p95 ${stats.p95Ms.toFixed(0)} ms · ${stats.motion === 'calm' ? 'calm' : stats.levelName}` : 'Starting…'}
                </button>
            </Glass>

            {open && (
                <Glass kind="thick" floats className={styles.panel}>
                    <p className={styles.panelTitle}>How the cards are drawn</p>
                    <div className={styles.options}>
                        {MODES.map((m) => (
                            <button key={m.id} type="button" aria-pressed={mode === m.id} className={styles.option} onClick={() => setMode(m.id)}>{m.label}</button>
                        ))}
                    </div>
                    <p className={styles.panelTitle}>Kind of glass</p>
                    <div className={styles.options}>
                        {GLASS_STYLE_IDS.map((id) => (
                            <button key={id} type="button" aria-pressed={glass === id} className={styles.option} onClick={() => setGlass(id)}>{id}</button>
                        ))}
                    </div>
                    <p className={styles.panelTitle}>Colour</p>
                    <div className={styles.swatches}>
                        {COLOR_PALETTES.map((p) => (
                            <button key={p.id} type="button" aria-label={p.name} aria-pressed={palette === p.id} className={styles.swatch} style={{ background: p.swatches[1] }} onClick={() => setPalette(p.id)} />
                        ))}
                    </div>
                    <div className={styles.options}>
                        <button type="button" aria-pressed={theme === 'dark'} className={styles.option} onClick={() => setTheme('dark')}>Dark</button>
                        <button type="button" aria-pressed={theme === 'light'} className={styles.option} onClick={() => setTheme('light')}>Light</button>
                    </div>
                    <p className={styles.panelTitle}>Quality</p>
                    <div className={styles.options}>
                        <button type="button" aria-pressed={level === null} className={styles.option} onClick={() => setLevel(null)}>Auto</button>
                        {QUALITY.map((q, i) => (
                            <button key={q.name} type="button" aria-pressed={level === i} className={styles.option} onClick={() => setLevel(i)}>{q.name}</button>
                        ))}
                    </div>
                    <div className={styles.options}>
                        <button type="button" className={styles.option} disabled={benching} onClick={runBench}>Run speed test</button>
                        <button type="button" className={styles.option} onClick={() => getGlassEngine()?.simulateLostContext()}>Lose the GPU</button>
                        <button type="button" className={styles.option} onClick={() => setMotion(motion === 'calm' ? 'full' : 'calm')}>{motion === 'calm' ? 'Motion on' : 'Calm'}</button>
                    </div>
                    {bench && (
                        <table className={styles.results}>
                            <thead>
                                <tr><th scope="col">Test</th><th scope="col">fps</th><th scope="col">p95</th><th scope="col">worst</th><th scope="col">level</th></tr>
                            </thead>
                            <tbody>
                                {bench.map((r) => (
                                    <tr key={r.name}><td>{r.name}</td><td>{r.fps}</td><td>{r.p95}</td><td>{r.worst}</td><td>{r.level}</td></tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                    {cost && (
                        <p className={styles.facts}>
                            One frame on the GPU: liquid {cost.liquidMs.toFixed(1)} ms + screen {cost.screenMs.toFixed(1)} ms = {(cost.liquidMs + cost.screenMs).toFixed(1)} ms of 16.7
                        </p>
                    )}
                    {stats && (
                        <p className={styles.facts}>
                            {stats.supported ? stats.gpu : 'No usable GPU: CSS glass'}<br />
                            Screen {stats.backing[0]}×{stats.backing[1]} · liquid {stats.liquid[0]}×{stats.liquid[1]} · {stats.surfaces} surfaces<br />
                            Extra height {stats.overscan} px · GPU losses {stats.losses}
                            {stats.capMs > 0 && ` · limited to ${Math.round(1000 / stats.capMs)} fps by the device`}
                        </p>
                    )}
                </Glass>
            )}

            <main className={styles.main}>
                <section className={styles.hello}>
                    <p className={styles.quiet}>Good afternoon</p>
                    <h1 className={styles.name}>Hi, Asha</h1>
                </section>

                <Glass as="section" kind="accent" className={styles.hero}>
                    <p className={styles.heroLabel}>Net balance</p>
                    <p className={styles.heroValue}>+₹42,049.12</p>
                    <p className={styles.heroNote}>You&rsquo;re owed overall</p>
                    <div className={styles.heroTiles}>
                        <Glass kind="thin" className={styles.tile}><span>You owe</span><strong>₹265</strong></Glass>
                        <Glass kind="thin" className={styles.tile}><span>Owed to you</span><strong>₹42,314.12</strong></Glass>
                    </div>
                </Glass>

                <section className={styles.actions}>
                    {['Add', 'Settle', 'Scan', 'Insights'].map((label, i) => (
                        <div key={label} className={styles.action}>
                            <Glass as="button" type="button" aria-label={label} kind={i === 0 ? 'accent' : 'thin'} className={styles.round}><span aria-hidden="true">{label.charAt(0)}</span></Glass>
                            <span className={styles.actionLabel}>{label}</span>
                        </div>
                    ))}
                </section>

                <h2 className={styles.heading}>Your groups</h2>
                <div className={styles.carousel}>
                    {GROUPS.map((g) => (
                        <Glass key={g.name} kind="reg" floats className={styles.groupCard}>
                            <strong>{g.name}</strong>
                            <span className={styles.quiet}>{g.meta}</span>
                            <span className={styles.money}>{g.balance}</span>
                        </Glass>
                    ))}
                </div>

                <h2 className={styles.heading}>Settle up</h2>
                <Glass as="section" kind="reg" className={styles.list}>
                    {OWES_YOU.map((row) => (
                        <div key={row.where + row.amount} className={styles.row}>
                            <span className={styles.avatar} aria-hidden="true">{row.initials}</span>
                            <span className={styles.rowText}><strong>{row.who}</strong><span className={styles.quiet}>{row.where}</span></span>
                            <span className={styles.rowEnd}><strong className={styles.money}>{row.amount}</strong><span className={styles.quiet}>Tap to remind</span></span>
                        </div>
                    ))}
                </Glass>

                <h2 className={styles.heading}>Recent activity</h2>
                <Glass as="section" kind="reg" className={styles.list}>
                    {ACTIVITY.map((row) => (
                        <div key={row.title} className={styles.row}>
                            <span className={styles.avatar} aria-hidden="true">{row.title.charAt(0)}</span>
                            <span className={styles.rowText}><strong>{row.title}</strong><span className={styles.quiet}>{row.meta}</span></span>
                            <span className={styles.rowEnd}><strong>{row.amount}</strong><span className={styles.quiet}>{row.share}</span></span>
                        </div>
                    ))}
                </Glass>

                <h2 className={styles.heading}>Explore</h2>
                <div className={styles.grid}>
                    {MORE.map((title, i) => (
                        <Glass key={title} kind={i % 3 === 0 ? 'clear' : i % 3 === 1 ? 'thin' : 'thick'} className={styles.gridCard}>
                            <strong>{title}</strong>
                        </Glass>
                    ))}
                </div>
            </main>

            <Glass as="nav" kind="thin" floats className={styles.dock} aria-label="Sample navigation">
                {NAV.map((label) => (label === '+'
                    ? <Glass key={label} as="button" type="button" kind="accent" floats aria-label="Add expense" className={styles.dockAdd}>+</Glass>
                    : <button key={label} type="button" className={styles.dockItem} aria-current={label === 'Home' ? 'page' : undefined}>{label}</button>
                ))}
            </Glass>
        </div>
    );
}
