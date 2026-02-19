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
    {
        target: '[data-tour="add-expense"]',
        title: '📸 Receipt Scanner',
        description: 'Tap the + button and scan any UPI receipt, GPay screenshot, or bill. AI extracts amounts, merchants & payment methods automatically.',
        position: 'top',
    },
    {
        target: '[data-tour="/transactions"]',
        title: '📅 Activity Timeline',
        description: 'Toggle between list and timeline views. The timeline groups your expenses by day with a beautiful vertical feed.',
        position: 'top',
    },
    {
        target: '[data-tour="/groups"]',
        title: '⚡ Simplify Debts',
        description: 'Groups now show a "Simplify Debts" section — an algorithm finds the minimum transfers needed to settle all balances.',
        position: 'top',
    },
    {
        target: '[data-tour="/settlements"]',
        title: '🔔 Smart Notifications',
        description: 'A notification banner shows pending settlements. One tap takes you to the settle-up page.',
        position: 'top',
    },
    {
        target: '[data-tour="/dashboard"]',
        title: '🔄 Pull to Refresh',
        description: 'Swipe down on the dashboard to refresh all your data with a smooth animation. Works on mobile!',
        position: 'top',
    },
];

const STORAGE_KEY = 'autosplit-tour-seen';

export default function OnboardingTour() {
    const [active, setActive] = useState(false);
    const [step, setStep] = useState(0);
    const [spotlightRect, setSpotlightRect] = useState<DOMRect | null>(null);
    const timerRef = useRef<number>(undefined);

    // Check if tour has been seen
    useEffect(() => {
        try {
            const seen = localStorage.getItem(STORAGE_KEY);
            if (!seen) {
                // Delay to allow page to render, then find first visible step
                timerRef.current = window.setTimeout(() => {
                    const firstVisible = TOUR_STEPS.findIndex(s => document.querySelector(s.target));
                    if (firstVisible >= 0) {
                        setStep(firstVisible);
                        setActive(true);
                    }
                }, 800);
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

    // Find next step that has a visible target element
    const next = useCallback(() => {
        let nextStep = step + 1;
        while (nextStep < TOUR_STEPS.length) {
            const el = document.querySelector(TOUR_STEPS[nextStep].target);
            if (el) { setStep(nextStep); return; }
            nextStep++;
        }
        dismiss(); // No more visible steps
    }, [step, dismiss]);

    // Find previous step that has a visible target element
    const prev = useCallback(() => {
        let prevStep = step - 1;
        while (prevStep >= 0) {
            const el = document.querySelector(TOUR_STEPS[prevStep].target);
            if (el) { setStep(prevStep); return; }
            prevStep--;
        }
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

    // Tooltip position relative to spotlight — always clamped to viewport
    const getTooltipStyle = (): React.CSSProperties => {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const pad = 12;
        const edgePad = 16;
        const tooltipW = Math.min(280, vw - edgePad * 2);
        const tooltipH = 160; // estimated tooltip height

        if (!spotlightRect) {
            return { top: '50%', left: edgePad, right: edgePad, maxWidth: tooltipW, margin: '0 auto', transform: 'translateY(-50%)' };
        }

        const centerX = spotlightRect.left + spotlightRect.width / 2;

        // Try preferred position, fall back if it won't fit
        const pos = currentStep.position || 'bottom';
        let top: number;
        let left: number;

        if (pos === 'bottom' || pos === 'top') {
            left = Math.max(edgePad, Math.min(centerX - tooltipW / 2, vw - tooltipW - edgePad));

            if (pos === 'bottom') {
                top = spotlightRect.bottom + pad;
                // If overflows bottom, place above
                if (top + tooltipH > vh - edgePad) {
                    top = Math.max(edgePad, spotlightRect.top - pad - tooltipH);
                }
            } else {
                top = spotlightRect.top - pad - tooltipH;
                // If overflows top, place below
                if (top < edgePad) {
                    top = spotlightRect.bottom + pad;
                }
            }
        } else if (pos === 'right') {
            left = spotlightRect.right + pad;
            top = Math.max(edgePad, Math.min(spotlightRect.top, vh - tooltipH - edgePad));

            // If overflows right, place below the element instead
            if (left + tooltipW > vw - edgePad) {
                left = Math.max(edgePad, Math.min(centerX - tooltipW / 2, vw - tooltipW - edgePad));
                top = spotlightRect.bottom + pad;
                if (top + tooltipH > vh - edgePad) {
                    top = Math.max(edgePad, spotlightRect.top - pad - tooltipH);
                }
            }
        } else {
            // left
            left = spotlightRect.left - pad - tooltipW;
            top = Math.max(edgePad, Math.min(spotlightRect.top, vh - tooltipH - edgePad));

            // If overflows left, place below the element instead
            if (left < edgePad) {
                left = Math.max(edgePad, Math.min(centerX - tooltipW / 2, vw - tooltipW - edgePad));
                top = spotlightRect.bottom + pad;
                if (top + tooltipH > vh - edgePad) {
                    top = Math.max(edgePad, spotlightRect.top - pad - tooltipH);
                }
            }
        }

        // Final safety clamp
        top = Math.max(edgePad, Math.min(top, vh - tooltipH - edgePad));
        left = Math.max(edgePad, Math.min(left, vw - tooltipW - edgePad));

        // Compute safe width that can never overflow right edge
        const safeWidth = Math.min(tooltipW, vw - left - edgePad);

        return { top, left, width: safeWidth };
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

                    <motion.div
                        key={step}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={{ duration: 0.25 }}
                        style={{
                            position: 'fixed',
                            ...getTooltipStyle(),
                            boxSizing: 'border-box',
                            background: 'var(--surface-popover, rgba(255, 255, 255, 0.98))',
                            backdropFilter: 'blur(24px)',
                            WebkitBackdropFilter: 'blur(24px)',
                            border: '1px solid var(--border-default, rgba(0,0,0,0.08))',
                            borderRadius: 16,
                            padding: '14px 16px',
                            boxShadow: '0 16px 48px rgba(0,0,0,0.15)',
                            textAlign: 'center',
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

                        {/* Controls — fully centered */}
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                            {/* Step dots */}
                            <div style={{ display: 'flex', gap: 5, justifyContent: 'center' }}>
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

                            {/* Buttons */}
                            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
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
