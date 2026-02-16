'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ChevronRight, ChevronLeft, Sparkles } from 'lucide-react';

interface TourStep {
    target: string;        // CSS selector for the element to highlight
    title: string;
    description: string;
    position?: 'top' | 'bottom' | 'left' | 'right';
}

const TOUR_STEPS: TourStep[] = [
    {
        target: '[aria-label="Choose color palette"]',
        title: '🎨 Color Themes',
        description: 'Choose from 12 beautiful color palettes. Your preference is saved automatically.',
        position: 'bottom',
    },
    {
        target: '[aria-label="Toggle dark/light mode"]',
        title: '🌓 Dark / Light Mode',
        description: 'Switch between dark and light mode with a single tap.',
        position: 'bottom',
    },
    {
        target: '[data-tour="dashboard-stats"]',
        title: '📊 Live Stats',
        description: 'Track your spending at a glance — all numbers animate in real time.',
        position: 'bottom',
    },
    {
        target: '[data-tour="quick-actions"]',
        title: '⚡ Quick Actions',
        description: 'Add expenses, scan receipts, or settle up — all from the dashboard.',
        position: 'top',
    },
];

const STORAGE_KEY = 'autosplit-tour-seen';

export default function OnboardingTour() {
    const [active, setActive] = useState(false);
    const [step, setStep] = useState(0);
    const [spotlightRect, setSpotlightRect] = useState<DOMRect | null>(null);
    const timerRef = useRef<number>();

    // Check if tour has been seen
    useEffect(() => {
        try {
            const seen = localStorage.getItem(STORAGE_KEY);
            if (!seen) {
                // Delay to allow page to render
                timerRef.current = window.setTimeout(() => setActive(true), 1500);
            }
        } catch {
            // localStorage unavailable
        }
        return () => clearTimeout(timerRef.current);
    }, []);

    // Update spotlight position
    useEffect(() => {
        if (!active) return;
        const currentStep = TOUR_STEPS[step];
        if (!currentStep) return;

        const el = document.querySelector(currentStep.target);
        if (el) {
            const rect = el.getBoundingClientRect();
            setSpotlightRect(rect);
        } else {
            setSpotlightRect(null);
        }
    }, [active, step]);

    const dismiss = useCallback(() => {
        setActive(false);
        try {
            localStorage.setItem(STORAGE_KEY, 'true');
        } catch { /* noop */ }
    }, []);

    const next = useCallback(() => {
        if (step < TOUR_STEPS.length - 1) {
            setStep(s => s + 1);
        } else {
            dismiss();
        }
    }, [step, dismiss]);

    const prev = useCallback(() => {
        if (step > 0) setStep(s => s - 1);
    }, [step]);

    // Escape to close
    useEffect(() => {
        if (!active) return;
        const handleKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') dismiss();
            if (e.key === 'ArrowRight') next();
            if (e.key === 'ArrowLeft') prev();
        };
        document.addEventListener('keydown', handleKey);
        return () => document.removeEventListener('keydown', handleKey);
    }, [active, dismiss, next, prev]);

    if (!active) return null;

    const currentStep = TOUR_STEPS[step];
    const isLast = step === TOUR_STEPS.length - 1;

    // Tooltip position relative to spotlight
    const getTooltipStyle = (): React.CSSProperties => {
        if (!spotlightRect) {
            return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
        }
        const pos = currentStep.position || 'bottom';
        const pad = 16;
        switch (pos) {
            case 'bottom':
                return {
                    top: spotlightRect.bottom + pad,
                    left: Math.max(16, Math.min(spotlightRect.left + spotlightRect.width / 2 - 150, window.innerWidth - 316)),
                };
            case 'top':
                return {
                    bottom: window.innerHeight - spotlightRect.top + pad,
                    left: Math.max(16, Math.min(spotlightRect.left + spotlightRect.width / 2 - 150, window.innerWidth - 316)),
                };
            case 'left':
                return {
                    top: spotlightRect.top,
                    right: window.innerWidth - spotlightRect.left + pad,
                };
            case 'right':
                return {
                    top: spotlightRect.top,
                    left: spotlightRect.right + pad,
                };
            default:
                return { top: spotlightRect.bottom + pad, left: spotlightRect.left };
        }
    };

    return (
        <AnimatePresence>
            {active && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    style={{
                        position: 'fixed',
                        inset: 0,
                        zIndex: 99999,
                    }}
                >
                    {/* Dark overlay with spotlight cutout */}
                    <svg
                        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
                        onClick={dismiss}
                    >
                        <defs>
                            <mask id="tour-mask">
                                <rect width="100%" height="100%" fill="white" />
                                {spotlightRect && (
                                    <rect
                                        x={spotlightRect.left - 8}
                                        y={spotlightRect.top - 8}
                                        width={spotlightRect.width + 16}
                                        height={spotlightRect.height + 16}
                                        rx={12}
                                        fill="black"
                                    />
                                )}
                            </mask>
                        </defs>
                        <rect
                            width="100%"
                            height="100%"
                            fill="rgba(0,0,0,0.6)"
                            mask="url(#tour-mask)"
                        />
                    </svg>

                    {/* Spotlight ring */}
                    {spotlightRect && (
                        <motion.div
                            layoutId="spotlight"
                            style={{
                                position: 'absolute',
                                left: spotlightRect.left - 8,
                                top: spotlightRect.top - 8,
                                width: spotlightRect.width + 16,
                                height: spotlightRect.height + 16,
                                borderRadius: 12,
                                border: '2px solid var(--accent-500)',
                                boxShadow: '0 0 20px rgba(var(--accent-500-rgb), 0.3)',
                                pointerEvents: 'none',
                            }}
                            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                        />
                    )}

                    {/* Tooltip card */}
                    <motion.div
                        key={step}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={{ duration: 0.25 }}
                        style={{
                            position: 'fixed',
                            ...getTooltipStyle(),
                            width: 300,
                            background: 'var(--bg-glass, rgba(14, 14, 40, 0.92))',
                            backdropFilter: 'blur(24px)',
                            WebkitBackdropFilter: 'blur(24px)',
                            border: '1px solid var(--border-glass, rgba(255,255,255,0.1))',
                            borderRadius: 16,
                            padding: '20px',
                            boxShadow: '0 16px 48px rgba(0,0,0,0.3)',
                        }}
                    >
                        {/* Close */}
                        <button
                            onClick={dismiss}
                            style={{
                                position: 'absolute',
                                top: 10,
                                right: 10,
                                background: 'none',
                                border: 'none',
                                color: 'var(--fg-muted)',
                                cursor: 'pointer',
                                padding: 4,
                            }}
                        >
                            <X size={16} />
                        </button>

                        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--fg-primary)', marginBottom: 6 }}>
                            {currentStep.title}
                        </div>
                        <div style={{ fontSize: 13, color: 'var(--fg-secondary)', lineHeight: 1.5, marginBottom: 16 }}>
                            {currentStep.description}
                        </div>

                        {/* Controls */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            {/* Step dots */}
                            <div style={{ display: 'flex', gap: 5 }}>
                                {TOUR_STEPS.map((_, i) => (
                                    <div
                                        key={i}
                                        style={{
                                            width: 6,
                                            height: 6,
                                            borderRadius: '50%',
                                            background: i === step ? 'var(--accent-500)' : 'var(--fg-muted)',
                                            opacity: i === step ? 1 : 0.3,
                                            transition: 'all 0.2s',
                                        }}
                                    />
                                ))}
                            </div>

                            <div style={{ display: 'flex', gap: 8 }}>
                                {step > 0 && (
                                    <button
                                        onClick={prev}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 4,
                                            padding: '6px 12px',
                                            borderRadius: 8,
                                            border: '1px solid var(--border-default)',
                                            background: 'transparent',
                                            color: 'var(--fg-secondary)',
                                            cursor: 'pointer',
                                            fontSize: 12,
                                            fontWeight: 600,
                                        }}
                                    >
                                        <ChevronLeft size={14} /> Back
                                    </button>
                                )}
                                <button
                                    onClick={next}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 4,
                                        padding: '6px 14px',
                                        borderRadius: 8,
                                        border: 'none',
                                        background: 'var(--accent-500)',
                                        color: 'white',
                                        cursor: 'pointer',
                                        fontSize: 12,
                                        fontWeight: 700,
                                    }}
                                >
                                    {isLast ? (
                                        <>
                                            <Sparkles size={14} /> Done
                                        </>
                                    ) : (
                                        <>
                                            Next <ChevronRight size={14} />
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
