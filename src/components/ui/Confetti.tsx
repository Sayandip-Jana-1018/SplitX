'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useHaptics } from '@/hooks/useHaptics';

interface ConfettiProps {
    active: boolean;
    duration?: number;
    message?: string;
    onComplete?: () => void;
}

interface Particle {
    x: number;
    y: number;
    vx: number;
    vy: number;
    color: string;
    size: number;
    rotation: number;
    rotationSpeed: number;
    opacity: number;
}

const COLORS = [
    '#6366f1', '#8b5cf6', '#a855f7', '#ec4899',
    '#f43f5e', '#10b981', '#06b6d4', '#f59e0b',
    '#3b82f6', '#22c55e',
];

/**
 * Numbers in [0, 1) from the browser's secure source. Confetti needs no secrecy,
 * but a scanner can't tell a particle from a token, and 960 numbers a burst cost
 * nothing, so the findings left in the code are the ones that matter (D-098).
 */
function randoms(count: number): number[] {
    return Array.from(crypto.getRandomValues(new Uint32Array(count)), (value) => value / 2 ** 32);
}

export default function Confetti({ active, duration = 3500, message, onComplete }: ConfettiProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const particlesRef = useRef<Particle[]>([]);
    const rafRef = useRef<number>(0);
    const [showMessage, setShowMessage] = useState(false);
    const haptics = useHaptics();

    const createParticles = useCallback(() => {
        const particles: Particle[] = [];
        for (let i = 0; i < 120; i++) {
            const [x, y, vx, vy, color, size, rotation, spin] = randoms(8);
            particles.push({
                x: x * window.innerWidth,
                y: -20 - y * 100,
                vx: (vx - 0.5) * 8,
                vy: vy * 4 + 2,
                color: COLORS[Math.floor(color * COLORS.length)],
                size: size * 8 + 4,
                rotation: rotation * 360,
                rotationSpeed: (spin - 0.5) * 10,
                opacity: 1,
            });
        }
        return particles;
    }, []);

    useEffect(() => {
        if (!active || !canvasRef.current) return;

        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;

        particlesRef.current = createParticles();
        const startTime = Date.now();

        // Haptic and message
        haptics.success();

        if (message) {
            setTimeout(() => setShowMessage(true), 0);
        }

        const animate = () => {
            const elapsed = Date.now() - startTime;
            if (elapsed > duration) {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                setShowMessage(false);
                onComplete?.();
                return;
            }

            ctx.clearRect(0, 0, canvas.width, canvas.height);

            particlesRef.current.forEach((p) => {
                p.x += p.vx;
                p.y += p.vy;
                p.vy += 0.1;
                p.rotation += p.rotationSpeed;
                p.opacity = Math.max(0, 1 - elapsed / duration);

                ctx.save();
                ctx.translate(p.x, p.y);
                ctx.rotate((p.rotation * Math.PI) / 180);
                ctx.globalAlpha = p.opacity;
                ctx.fillStyle = p.color;
                ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
                ctx.restore();
            });

            rafRef.current = requestAnimationFrame(animate);
        };

        rafRef.current = requestAnimationFrame(animate);

        return () => {
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
        };
    }, [active, duration, createParticles, haptics, message, onComplete]);

    if (!active) return null;

    return (
        <>
            <canvas
                ref={canvasRef}
                style={{
                    position: 'fixed',
                    inset: 0,
                    zIndex: 9999,
                    pointerEvents: 'none',
                }}
            />
            {/* Celebration message overlay */}
            <AnimatePresence>
                {showMessage && message && (
                    <motion.div
                        initial={{ scale: 0, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.8, opacity: 0 }}
                        transition={{ type: 'spring', damping: 12, delay: 0.15 }}
                        style={{
                            position: 'fixed', inset: 0, zIndex: 10000,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            pointerEvents: 'none',
                        }}
                    >
                        <div style={{
                            background: 'var(--bg-glass)',
                            backdropFilter: 'blur(24px) saturate(1.5)',
                            WebkitBackdropFilter: 'blur(24px) saturate(1.5)',
                            border: '1px solid var(--border-glass)',
                            borderRadius: 'var(--radius-2xl)',
                            padding: 'var(--space-5) var(--space-8)',
                            boxShadow: 'var(--shadow-card), 0 0 40px rgba(var(--accent-500-rgb), 0.15)',
                            textAlign: 'center',
                        }}>
                            <div style={{ fontSize: 36, marginBottom: 8 }}>🎉</div>
                            <div style={{
                                fontWeight: 800, fontSize: 'var(--text-lg)',
                                background: 'linear-gradient(135deg, var(--accent-400), var(--accent-500))',
                                WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
                                backgroundClip: 'text',
                            }}>
                                {message}
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </>
    );
}
