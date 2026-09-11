'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight, ChevronLeft, Sparkles, X } from 'lucide-react';
import { TOUR_STORAGE_KEY, UI_EVENTS } from '@/lib/uiEvents';

interface TourStep {
    target?: string;
    title: string;
    description: string;
    position?: 'top' | 'bottom';
}

const TOUR_STEPS: TourStep[] = [
    {
        target: '[data-tour="balance"]',
        title: 'Your money at a glance',
        description: 'Your net balance across every group. Tap either tile to jump straight to settling up.',
        position: 'bottom',
    },
    {
        target: '[data-tour="quick-actions"]',
        title: 'One-tap actions',
        description: 'Add an expense, settle up, scan a receipt or open insights — all from Home.',
        position: 'bottom',
    },
    {
        target: '[data-tour="/transactions/new"]',
        title: 'Add expenses in seconds',
        description: 'The + button opens a calculator-style composer with voice input and smart splits.',
        position: 'top',
    },
    {
        target: '[data-tour="/groups"]',
        title: 'Groups for everything',
        description: 'Trips, flatmates, office lunches. Invite friends with a link or a QR code.',
        position: 'top',
    },
    {
        target: '[data-tour="/settlements"]',
        title: 'Settle up smarter',
        description: 'We simplify debts into the fewest payments. Pay via UPI or mark cash as received.',
        position: 'top',
    },
    {
        target: '[data-tour="ai"]',
        title: 'Ask SplitX AI',
        description: 'Ask who owes you, what you spent on food, or how to settle — in plain English.',
        position: 'bottom',
    },
    {
        title: 'You’re all set',
        description: 'Pull down on Home to refresh anytime. Personalise colours and dark mode in Settings.',
    },
];

const STORAGE_KEY = TOUR_STORAGE_KEY;

function isStepAvailable(step: TourStep) {
    return !step.target || Boolean(document.querySelector(step.target));
}

export default function OnboardingTour() {
    const [active, setActive] = useState(false);
    const [step, setStep] = useState(0);
    const [spotlightRect, setSpotlightRect] = useState<DOMRect | null>(null);
    const timerRef = useRef<number | undefined>(undefined);

    useEffect(() => {
        try {
            if (!localStorage.getItem(STORAGE_KEY)) {
                timerRef.current = window.setTimeout(() => {
                    const firstVisible = TOUR_STEPS.findIndex(isStepAvailable);
                    if (firstVisible >= 0 && document.querySelector('[data-tour="balance"]')) {
                        setStep(firstVisible);
                        setActive(true);
                    }
                }, 900);
            }
        } catch {
            // storage unavailable
        }
        return () => window.clearTimeout(timerRef.current);
    }, []);

    // Replay on demand (Settings → Replay the tour). Waits for Home to render its balance card.
    useEffect(() => {
        let poll: number | undefined;
        const handleStart = () => {
            let attempts = 0;
            window.clearInterval(poll);
            poll = window.setInterval(() => {
                attempts += 1;
                if (document.querySelector('[data-tour="balance"]')) {
                    window.clearInterval(poll);
                    const firstVisible = TOUR_STEPS.findIndex(isStepAvailable);
                    if (firstVisible >= 0) {
                        setStep(firstVisible);
                        setActive(true);
                    }
                } else if (attempts > 50) {
                    window.clearInterval(poll);
                }
            }, 160);
        };
        window.addEventListener(UI_EVENTS.startTour, handleStart);
        return () => {
            window.removeEventListener(UI_EVENTS.startTour, handleStart);
            window.clearInterval(poll);
        };
    }, []);

    useEffect(() => {
        if (!active) return;
        let lastTarget: string | undefined;
        let frame = 0;

        const measure = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => {
                const current = TOUR_STEPS[step];
                if (!current?.target) {
                    setSpotlightRect(null);
                    return;
                }
                const element = document.querySelector(current.target);
                if (!element) {
                    setSpotlightRect(null);
                    return;
                }
                if (lastTarget !== current.target) {
                    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    lastTarget = current.target;
                }
                setSpotlightRect(element.getBoundingClientRect());
            });
        };

        measure();
        window.addEventListener('resize', measure);
        window.addEventListener('scroll', measure, true);
        return () => {
            cancelAnimationFrame(frame);
            window.removeEventListener('resize', measure);
            window.removeEventListener('scroll', measure, true);
        };
    }, [active, step]);

    const dismiss = useCallback(() => {
        setActive(false);
        try {
            localStorage.setItem(STORAGE_KEY, 'true');
        } catch { /* noop */ }
    }, []);

    const next = useCallback(() => {
        for (let index = step + 1; index < TOUR_STEPS.length; index++) {
            if (isStepAvailable(TOUR_STEPS[index])) {
                setStep(index);
                return;
            }
        }
        dismiss();
    }, [step, dismiss]);

    const prev = useCallback(() => {
        for (let index = step - 1; index >= 0; index--) {
            if (isStepAvailable(TOUR_STEPS[index])) {
                setStep(index);
                return;
            }
        }
    }, [step]);

    useEffect(() => {
        if (!active) return;
        const handleKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') dismiss();
            if (event.key === 'ArrowRight') next();
            if (event.key === 'ArrowLeft') prev();
        };
        document.addEventListener('keydown', handleKey);
        return () => document.removeEventListener('keydown', handleKey);
    }, [active, dismiss, next, prev]);

    if (!active) return null;

    const current = TOUR_STEPS[step];
    const isLast = step === TOUR_STEPS.length - 1;

    const getTooltipStyle = (): React.CSSProperties => {
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const edge = 16;
        const gap = 14;
        const width = Math.min(320, viewportWidth - edge * 2);
        const estimatedHeight = 190;

        if (!spotlightRect) {
            return { top: '50%', left: '50%', width, transform: 'translate(-50%, -50%)' };
        }

        const centerX = spotlightRect.left + spotlightRect.width / 2;
        const left = Math.max(edge, Math.min(centerX - width / 2, viewportWidth - width - edge));
        let top = current.position === 'top'
            ? spotlightRect.top - gap - estimatedHeight
            : spotlightRect.bottom + gap;
        if (top + estimatedHeight > viewportHeight - edge) top = spotlightRect.top - gap - estimatedHeight;
        if (top < edge) top = Math.min(spotlightRect.bottom + gap, viewportHeight - estimatedHeight - edge);
        return { top: Math.max(edge, top), left, width };
    };

    const visibleSteps = TOUR_STEPS.filter(isStepAvailable);
    const visibleIndex = visibleSteps.indexOf(current);

    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                style={{ position: 'fixed', inset: 0, zIndex: 99999 }}
            >
                <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} onClick={dismiss}>
                    <defs>
                        <mask id="splitx-tour-mask">
                            <rect width="100%" height="100%" fill="white" />
                            {spotlightRect && (
                                <rect
                                    x={spotlightRect.left - 8}
                                    y={spotlightRect.top - 8}
                                    width={spotlightRect.width + 16}
                                    height={spotlightRect.height + 16}
                                    rx={20}
                                    fill="black"
                                />
                            )}
                        </mask>
                    </defs>
                    <rect width="100%" height="100%" fill="rgba(6, 8, 14, 0.62)" mask="url(#splitx-tour-mask)" />
                </svg>

                {spotlightRect && (
                    <motion.div
                        layout
                        style={{
                            position: 'absolute',
                            left: spotlightRect.left - 8,
                            top: spotlightRect.top - 8,
                            width: spotlightRect.width + 16,
                            height: spotlightRect.height + 16,
                            borderRadius: 20,
                            border: '2px solid var(--accent-400)',
                            boxShadow: '0 0 0 6px rgba(var(--accent-500-rgb), 0.18), 0 0 32px rgba(var(--accent-500-rgb), 0.45)',
                            pointerEvents: 'none',
                        }}
                        transition={{ type: 'spring', damping: 28, stiffness: 320 }}
                    />
                )}

                <motion.div
                    key={step}
                    role="dialog"
                    aria-label={current.title}
                    initial={{ opacity: 0, y: 10, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ type: 'spring', damping: 26, stiffness: 360 }}
                    style={{
                        position: 'fixed',
                        ...getTooltipStyle(),
                        padding: 18,
                        borderRadius: 22,
                        background: 'var(--surface-popover)',
                        border: '1px solid var(--border-default)',
                        boxShadow: 'var(--shadow-2xl)',
                    }}
                >
                    <button
                        type="button"
                        onClick={dismiss}
                        aria-label="Skip tour"
                        style={{
                            position: 'absolute',
                            top: 12,
                            right: 12,
                            width: 30,
                            height: 30,
                            borderRadius: '50%',
                            display: 'grid',
                            placeItems: 'center',
                            color: 'var(--fg-muted)',
                            background: 'var(--bg-tertiary)',
                        }}
                    >
                        <X size={15} />
                    </button>

                    <span style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        fontSize: 11,
                        fontWeight: 700,
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                        color: 'var(--accent-strong)',
                    }}>
                        <Sparkles size={12} /> Step {visibleIndex + 1} of {visibleSteps.length}
                    </span>
                    <div style={{ marginTop: 8, paddingRight: 30, fontSize: 17, fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--fg-primary)' }}>
                        {current.title}
                    </div>
                    <p style={{ marginTop: 6, fontSize: 13.5, lineHeight: 1.55, color: 'var(--fg-secondary)' }}>
                        {current.description}
                    </p>

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 16 }}>
                        <div style={{ display: 'flex', gap: 5 }}>
                            {visibleSteps.map((visibleStep, index) => (
                                <span
                                    key={visibleStep.title}
                                    style={{
                                        width: index === visibleIndex ? 18 : 6,
                                        height: 6,
                                        borderRadius: 3,
                                        background: index === visibleIndex ? 'var(--accent-500)' : 'var(--border-strong)',
                                        transition: 'width 0.25s var(--ease-out)',
                                    }}
                                />
                            ))}
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                            {visibleIndex > 0 && (
                                <button
                                    type="button"
                                    onClick={prev}
                                    aria-label="Previous step"
                                    style={{
                                        width: 38,
                                        height: 38,
                                        borderRadius: '50%',
                                        display: 'grid',
                                        placeItems: 'center',
                                        background: 'var(--bg-tertiary)',
                                        color: 'var(--fg-secondary)',
                                    }}
                                >
                                    <ChevronLeft size={17} />
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={next}
                                style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 6,
                                    height: 38,
                                    padding: '0 16px',
                                    borderRadius: 999,
                                    background: 'var(--accent-gradient)',
                                    color: 'var(--fg-on-accent)',
                                    fontSize: 13.5,
                                    fontWeight: 700,
                                    boxShadow: 'var(--shadow-glow-sm)',
                                }}
                            >
                                {isLast ? 'Get started' : 'Next'}
                                <ArrowRight size={15} />
                            </button>
                        </div>
                    </div>
                </motion.div>
            </motion.div>
        </AnimatePresence>
    );
}
