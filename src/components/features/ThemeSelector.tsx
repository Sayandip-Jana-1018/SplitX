'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { Sun, Moon, Palette, Check, GripHorizontal } from 'lucide-react';
import { useState, useRef, useEffect, useCallback } from 'react';
import { useThemeContext, COLOR_PALETTES } from '@/components/providers/ThemeProvider';
import { useToast } from '@/components/ui/Toast';

export default function ThemeSelector() {
    const { theme, palette, toggleTheme, setPalette } = useThemeContext();
    const { toast } = useToast();
    const [open, setOpen] = useState(false);
    const [focusedIndex, setFocusedIndex] = useState(-1);
    const [isMobile, setIsMobile] = useState(false);
    const [showShimmer, setShowShimmer] = useState(true);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const listRef = useRef<HTMLDivElement>(null);

    // Shimmer skeleton on first open (300ms)
    useEffect(() => {
        if (open && showShimmer) {
            const t = setTimeout(() => setShowShimmer(false), 300);
            return () => clearTimeout(t);
        }
    }, [open, showShimmer]);

    // Detect mobile viewport
    useEffect(() => {
        const check = () => setIsMobile(window.innerWidth <= 640);
        check();
        window.addEventListener('resize', check);
        return () => window.removeEventListener('resize', check);
    }, []);

    // Reset focusedIndex when panel opens
    useEffect(() => {
        if (open) {
            const idx = COLOR_PALETTES.findIndex((p) => p.id === palette);
            setFocusedIndex(idx >= 0 ? idx : 0);
        }
    }, [open, palette]);

    // Close on click outside
    useEffect(() => {
        if (!open) return;
        const handleClick = (e: MouseEvent) => {
            if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, [open]);

    // Keyboard navigation
    const handleKeyDown = useCallback(
        (e: KeyboardEvent) => {
            if (!open) return;
            switch (e.key) {
                case 'Escape':
                    setOpen(false);
                    break;
                case 'ArrowDown':
                    e.preventDefault();
                    setFocusedIndex((i) => (i + 1) % COLOR_PALETTES.length);
                    break;
                case 'ArrowUp':
                    e.preventDefault();
                    setFocusedIndex((i) => (i - 1 + COLOR_PALETTES.length) % COLOR_PALETTES.length);
                    break;
                case 'Enter':
                case ' ':
                    e.preventDefault();
                    if (focusedIndex >= 0 && focusedIndex < COLOR_PALETTES.length) {
                        const p = COLOR_PALETTES[focusedIndex];
                        setPalette(p.id);
                        toast(`Switched to ${p.name}`);
                    }
                    break;
            }
        },
        [open, focusedIndex, setPalette, toast]
    );

    useEffect(() => {
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [handleKeyDown]);

    // Scroll focused item into view
    useEffect(() => {
        if (!open || focusedIndex < 0) return;
        const list = listRef.current;
        if (!list) return;
        const items = list.children;
        if (items[focusedIndex]) {
            (items[focusedIndex] as HTMLElement).scrollIntoView({ block: 'nearest' });
        }
    }, [focusedIndex, open]);

    const selectPalette = (p: (typeof COLOR_PALETTES)[number]) => {
        setPalette(p.id);
        toast(`Switched to ${p.name}`);
        if (isMobile) setOpen(false);
    };

    /* ── Shimmer skeleton rows ── */
    const shimmerRows = (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {[...Array(4)].map((_, i) => (
                <div
                    key={i}
                    style={{
                        height: 32,
                        borderRadius: 10,
                        background: 'linear-gradient(90deg, rgba(var(--accent-500-rgb),0.06) 25%, rgba(var(--accent-500-rgb),0.12) 50%, rgba(var(--accent-500-rgb),0.06) 75%)',
                        backgroundSize: '200% 100%',
                        animation: 'shimmer 1.2s infinite',
                    }}
                />
            ))}
            <style>{`@keyframes shimmer { 0% { background-position: 200% 0 } 100% { background-position: -200% 0 } }`}</style>
        </div>
    );

    /* ── Shared palette list content ── */
    const paletteList = showShimmer ? shimmerRows : (
        <div ref={listRef} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {COLOR_PALETTES.map((p, idx) => {
                const isActive = palette === p.id;
                const isFocused = idx === focusedIndex;
                return (
                    <motion.button
                        key={p.id}
                        onClick={() => selectPalette(p)}
                        whileTap={{ scale: 0.97 }}
                        whileHover={{ scale: 1.02 }}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                            padding: '10px 12px',
                            borderRadius: 14,
                            cursor: 'pointer',
                            fontSize: 13,
                            fontWeight: isActive ? 700 : 500,
                            letterSpacing: isActive ? '0.01em' : 'normal',
                            whiteSpace: 'nowrap',
                            transition: 'all 0.2s ease',
                            border: isActive
                                ? `1.5px solid ${p.accent500}`
                                : '1.5px solid transparent',
                            outline: isFocused && !isActive ? `2px solid var(--accent-500)` : 'none',
                            outlineOffset: -2,
                            background: isActive
                                ? `linear-gradient(135deg, rgba(${p.accent500rgb}, 0.18), rgba(${p.accent500rgb}, 0.06))`
                                : 'rgba(var(--accent-500-rgb), 0.03)',
                            color: isActive
                                ? p.accent500
                                : 'var(--fg-secondary)',
                            boxShadow: isActive
                                ? `0 2px 12px rgba(${p.accent500rgb}, 0.2)`
                                : 'none',
                        }}
                    >
                        {/* Swatch circles */}
                        <span style={{
                            display: 'flex',
                            gap: 4,
                            flexShrink: 0,
                            padding: '3px 6px',
                            borderRadius: 20,
                            background: isActive ? `rgba(${p.accent500rgb}, 0.1)` : 'rgba(var(--accent-500-rgb), 0.05)',
                        }}>
                            {p.swatches.map((color, i) => (
                                <span
                                    key={i}
                                    style={{
                                        width: 10,
                                        height: 10,
                                        borderRadius: '50%',
                                        background: color,
                                        boxShadow: `0 0 4px ${color}44`,
                                        border: '1px solid rgba(255,255,255,0.15)',
                                    }}
                                />
                            ))}
                        </span>
                        <span style={{ flex: 1, textAlign: 'left' }}>{p.name}</span>
                        {isActive && (
                            <motion.span
                                initial={{ scale: 0 }}
                                animate={{ scale: 1 }}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    width: 20,
                                    height: 20,
                                    borderRadius: '50%',
                                    background: p.accent500,
                                    color: '#fff',
                                    flexShrink: 0,
                                }}
                            >
                                <Check size={11} strokeWidth={3} />
                            </motion.span>
                        )}
                    </motion.button>
                );
            })}
        </div>
    );

    return (
        <div ref={wrapperRef} style={{ display: 'flex', alignItems: 'center', gap: 8, position: 'relative' }}>
            {/* Dark/Light toggle */}
            <motion.button
                whileTap={{ scale: 0.9, rotate: 180 }}
                transition={{ type: 'spring', stiffness: 300, damping: 15 }}
                onClick={toggleTheme}
                style={{
                    width: 36,
                    height: 36,
                    borderRadius: 'var(--radius-lg)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'rgba(var(--accent-500-rgb), 0.08)',
                    backdropFilter: 'blur(12px)',
                    WebkitBackdropFilter: 'blur(12px)',
                    border: '1px solid rgba(var(--accent-500-rgb), 0.12)',
                    color: 'var(--fg-secondary)',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                }}
                aria-label="Toggle dark/light mode"
            >
                <AnimatePresence mode="wait" initial={false}>
                    <motion.span
                        key={theme}
                        initial={{ opacity: 0, rotate: -90, scale: 0 }}
                        animate={{ opacity: 1, rotate: 0, scale: 1 }}
                        exit={{ opacity: 0, rotate: 90, scale: 0 }}
                        transition={{ duration: 0.2 }}
                        style={{ display: 'flex' }}
                    >
                        {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
                    </motion.span>
                </AnimatePresence>
            </motion.button>

            {/* Palette picker button */}
            <motion.button
                whileTap={{ scale: 0.9 }}
                onClick={() => setOpen(!open)}
                style={{
                    width: 36,
                    height: 36,
                    borderRadius: 'var(--radius-lg)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: open
                        ? `rgba(var(--accent-500-rgb), 0.15)`
                        : 'rgba(var(--accent-500-rgb), 0.08)',
                    backdropFilter: 'blur(12px)',
                    WebkitBackdropFilter: 'blur(12px)',
                    border: open
                        ? '1px solid var(--accent-500)'
                        : '1px solid rgba(var(--accent-500-rgb), 0.12)',
                    color: 'var(--accent-500)',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                }}
                aria-label="Choose color palette"
            >
                <Palette size={18} />
            </motion.button>

            {/* ── Desktop: Dropdown anchored to wrapper ── */}
            {!isMobile && (
                <AnimatePresence>
                    {open && (
                        <motion.div
                            initial={{ opacity: 0, y: -10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            transition={{ type: 'spring', damping: 26, stiffness: 380 }}
                            style={{
                                position: 'absolute',
                                top: 'calc(100% + 12px)',
                                right: 0,
                                width: 240,
                                maxHeight: 'calc(100vh - 100px)',
                                overflowY: 'auto',
                                background: 'rgba(var(--accent-500-rgb), 0.04)',
                                backdropFilter: 'blur(40px) saturate(1.5)',
                                WebkitBackdropFilter: 'blur(40px) saturate(1.5)',
                                border: '1px solid rgba(var(--accent-500-rgb), 0.1)',
                                borderRadius: 18,
                                padding: '14px 10px',
                                zIndex: 9999,
                                boxShadow: '0 12px 40px rgba(0,0,0,0.2)',
                            }}
                        >
                            <div style={{
                                textAlign: 'center',
                                marginBottom: 10,
                                fontSize: 13,
                                fontWeight: 700,
                                color: 'var(--fg-primary)',
                            }}>
                                ✨ Color Theme
                            </div>
                            {paletteList}
                        </motion.div>
                    )}
                </AnimatePresence>
            )}

            {/* ── Mobile: Premium Bottom Sheet ── */}
            {isMobile && (
                <AnimatePresence>
                    {open && (
                        <>
                            {/* Backdrop overlay with blur */}
                            <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                onClick={() => setOpen(false)}
                                style={{
                                    position: 'fixed',
                                    inset: 0,
                                    background: 'rgba(0,0,0,0.45)',
                                    backdropFilter: 'blur(4px)',
                                    WebkitBackdropFilter: 'blur(4px)',
                                    zIndex: 9998,
                                }}
                            />
                            {/* Sheet */}
                            <motion.div
                                initial={{ y: '100%' }}
                                animate={{ y: 0 }}
                                exit={{ y: '100%' }}
                                transition={{ type: 'spring', damping: 32, stiffness: 400 }}
                                drag="y"
                                dragConstraints={{ top: 0 }}
                                dragElastic={0.05}
                                onDragEnd={(_e, info) => {
                                    if (info.offset.y > 80) setOpen(false);
                                }}
                                style={{
                                    position: 'fixed',
                                    bottom: 0,
                                    left: 0,
                                    right: 0,
                                    maxHeight: '75vh',
                                    overflowY: 'auto',
                                    background: 'var(--bg-primary)',
                                    borderTop: '1px solid rgba(var(--accent-500-rgb), 0.12)',
                                    borderRadius: '24px 24px 0 0',
                                    padding: '0 20px 32px',
                                    zIndex: 9999,
                                    boxShadow: '0 -12px 60px rgba(0,0,0,0.25), 0 -2px 16px rgba(var(--accent-500-rgb), 0.08)',
                                }}
                            >
                                {/* Drag handle pill */}
                                <div style={{
                                    display: 'flex',
                                    justifyContent: 'center',
                                    padding: '12px 0 8px',
                                }}>
                                    <div style={{
                                        width: 40,
                                        height: 4,
                                        borderRadius: 2,
                                        background: 'rgba(var(--accent-500-rgb), 0.25)',
                                    }} />
                                </div>

                                {/* Header */}
                                <div style={{
                                    textAlign: 'center',
                                    marginBottom: 6,
                                }}>
                                    <span style={{
                                        fontSize: 17,
                                        fontWeight: 800,
                                        color: 'var(--fg-primary)',
                                        letterSpacing: '-0.02em',
                                    }}>
                                        🎨 Choose Theme
                                    </span>
                                    <p style={{
                                        fontSize: 12,
                                        color: 'var(--fg-tertiary)',
                                        marginTop: 4,
                                        marginBottom: 0,
                                    }}>
                                        Pick a color palette for your app
                                    </p>
                                </div>

                                {/* Gradient divider */}
                                <div style={{
                                    height: 1,
                                    margin: '10px 0 14px',
                                    background: 'linear-gradient(90deg, transparent, rgba(var(--accent-500-rgb), 0.25), transparent)',
                                }} />

                                {paletteList}

                                {/* Bottom safe area */}
                                <div style={{ height: 8 }} />
                            </motion.div>
                        </>
                    )}
                </AnimatePresence>
            )}
        </div>
    );
}
