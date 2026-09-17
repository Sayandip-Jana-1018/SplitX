'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
    DEFAULT_MEMBERS,
    MAX_MEMBERS,
    MIN_MEMBERS,
    clampMembers,
    nextDelayMs,
    podLabel,
    readOutcome,
    type Outcome,
    type PlanResult,
} from '@/lib/scaleDemo';
import styles from './scale.module.css';

const rupees = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const whole = new Intl.NumberFormat('en-IN');
const SEPARATOR = ' · ';

interface PodSeen {
    name: string;
    answers: number;
}

function describeProblem(outcome: Outcome, keepGoing: boolean): string {
    if (outcome.kind === 'busy') {
        return keepGoing
            ? 'Every server is flat out. Backing off and trying again shortly.'
            : 'Every server is flat out right now. Try again in a moment.';
    }
    if (outcome.kind === 'limited') {
        return 'This phone is planning faster than one device may. Waiting ' + outcome.retryAfterSeconds + ' s.';
    }
    if (outcome.kind === 'failed') {
        return outcome.status === 0 ? 'Could not reach SplitX. Check your connection.' : 'Something went wrong (HTTP ' + outcome.status + ').';
    }
    return '';
}

export default function ScaleDemo() {
    const [members, setMembers] = useState(DEFAULT_MEMBERS);
    const [plan, setPlan] = useState<PlanResult | null>(null);
    const [problem, setProblem] = useState<string | null>(null);
    const [working, setWorking] = useState(false);
    const [keepGoing, setKeepGoing] = useState(false);
    const [pods, setPods] = useState<PodSeen[]>([]);
    const [latestPod, setLatestPod] = useState<string | null>(null);
    const [plans, setPlans] = useState(0);

    const membersRef = useRef(members);
    const keepGoingRef = useRef(keepGoing);
    const streak = useRef(0);

    useEffect(() => {
        membersRef.current = members;
    }, [members]);
    useEffect(() => {
        keepGoingRef.current = keepGoing;
    }, [keepGoing]);

    const planOnce = useCallback(async (): Promise<Outcome> => {
        setWorking(true);
        const started = performance.now();
        let outcome: Outcome;
        try {
            const response = await fetch('/api/settlements/preview', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ scenario: { members: membersRef.current } }),
            });
            const body = await response.json().catch(() => null);
            outcome = readOutcome(response.status, body, response.headers.get('retry-after'), performance.now() - started);
        } catch {
            outcome = { kind: 'failed', status: 0 };
        }

        if (outcome.kind === 'planned') {
            const name = outcome.plan.pod ?? 'SplitX';
            streak.current = 0;
            setPlan(outcome.plan);
            setPlans((count) => count + 1);
            setLatestPod(name);
            setPods((seen) =>
                seen.some((pod) => pod.name === name)
                    ? seen.map((pod) => (pod.name === name ? { ...pod, answers: pod.answers + 1 } : pod))
                    : [...seen, { name, answers: 1 }]
            );
            setProblem(null);
        } else {
            streak.current += 1;
            setProblem(describeProblem(outcome, keepGoingRef.current));
        }
        setWorking(false);
        return outcome;
    }, []);

    // Keep planning: one plan at a time, paced and jittered so a classroom of
    // phones spreads its requests out, and paused while the page is hidden.
    useEffect(() => {
        if (!keepGoing) return;
        let cancelled = false;
        let timer: ReturnType<typeof setTimeout>;
        const tick = async () => {
            if (cancelled) return;
            if (document.hidden) {
                timer = setTimeout(tick, 1_000);
                return;
            }
            const outcome = await planOnce();
            if (!cancelled) timer = setTimeout(tick, nextDelayMs(outcome, streak.current));
        };
        timer = setTimeout(tick, 0);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [keepGoing, planOnce]);

    const saved = plan ? plan.greedyPayments - plan.payments : 0;

    return (
        <main className={styles.page}>
            <header className={styles.hero}>
                <p className={styles.eyebrow}>Live on Kubernetes</p>
                <h1 className={styles.title}>Settle a trip for a crowd</h1>
                <p className={styles.lede}>
                    Pick a group size and SplitX works out the fewest payments that settle everyone. Each plan is
                    computed live by one of the servers behind this page. Keep planning while the rest of the room
                    does, and watch more servers join in.
                </p>
            </header>

            <section className={styles.card} aria-labelledby="size-label">
                <div className={styles.sizeRow}>
                    <label id="size-label" htmlFor="group-size" className={styles.label}>
                        Group size
                    </label>
                    <output htmlFor="group-size" className={styles.size}>
                        {whole.format(members)} people
                    </output>
                </div>
                <input
                    id="group-size"
                    className={styles.slider}
                    type="range"
                    min={MIN_MEMBERS}
                    max={MAX_MEMBERS}
                    step={100}
                    value={members}
                    onChange={(event) => setMembers(clampMembers(Number(event.target.value)))}
                />
                <div className={styles.buttons}>
                    <button type="button" className={styles.primary} onClick={() => void planOnce()} disabled={working || keepGoing}>
                        {working && !keepGoing ? 'Planning...' : 'Plan it'}
                    </button>
                    <button type="button" className={styles.toggle} aria-pressed={keepGoing} onClick={() => setKeepGoing((on) => !on)}>
                        {keepGoing ? 'Stop' : 'Keep planning'}
                    </button>
                </div>
                <p className={styles.problem} role="status" aria-live="polite">
                    {problem}
                </p>
            </section>

            {plan && (
                <section className={styles.card} aria-live="polite">
                    <p className={styles.context}>
                        {whole.format(plan.people)} people{SEPARATOR}
                        {whole.format(plan.expenses)} expenses{SEPARATOR}
                        {rupees.format(plan.totalSpentPaise / 100)} spent
                    </p>
                    <p className={styles.payments}>
                        <strong>{whole.format(plan.payments)}</strong> payments settle everyone
                    </p>
                    <p className={styles.compare}>
                        {'instead of ' + whole.format(plan.directIous) + ' separate IOUs. '}
                        {saved > 0
                            ? 'A simple largest-first method needs ' + whole.format(plan.greedyPayments) + ', so this saves ' + whole.format(saved) + '.'
                            : 'The simple largest-first method happens to be optimal here.'}
                    </p>
                    <dl className={styles.meta}>
                        <div>
                            <dt>Planned in</dt>
                            <dd>{plan.computeMs < 10 ? plan.computeMs.toFixed(1) : Math.round(plan.computeMs)} ms</dd>
                        </div>
                        <div>
                            <dt>Round trip</dt>
                            <dd>{plan.roundTripMs} ms</dd>
                        </div>
                        <div>
                            <dt>Answered by</dt>
                            <dd className={styles.podName} title={plan.pod ?? undefined}>
                                {podLabel(plan.pod)}
                            </dd>
                        </div>
                    </dl>
                </section>
            )}

            <section className={styles.card} aria-labelledby="pods-title">
                <h2 id="pods-title" className={styles.subtitle}>
                    Servers that answered you
                </h2>
                {pods.length === 0 ? (
                    <p className={styles.hint}>Plan a trip to see which server does the work.</p>
                ) : (
                    <>
                        <ul className={styles.pods}>
                            {pods.map((pod) => (
                                <li key={pod.name} className={pod.name === latestPod ? styles.podActive : styles.pod} title={pod.name}>
                                    <span className={styles.podName}>{podLabel(pod.name)}</span>
                                    <span className={styles.answers}>{whole.format(pod.answers)}</span>
                                </li>
                            ))}
                        </ul>
                        <p className={styles.hint}>
                            {whole.format(plans) + (plans === 1 ? ' plan' : ' plans') + ' from this phone, answered by ' + pods.length + (pods.length === 1 ? ' server.' : ' servers.')}
                        </p>
                    </>
                )}
            </section>

            <footer className={styles.footer}>
                <Link href="/">SplitX home</Link>
            </footer>
        </main>
    );
}
