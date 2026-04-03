'use client';

import { useEffect, useRef } from 'react';
import type { PerformanceMode } from '@/hooks/usePerformanceMode';

interface Particle {
    x: number;
    y: number;
    vx: number;
    vy: number;
    radius: number;
    opacity: number;
    opacityDir: number;
}

export default function ParticleBackground({
    count = 40,
    className,
    mode = 'premium',
}: {
    count?: number;
    className?: string;
    mode?: PerformanceMode;
}) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const animRef = useRef<number>(0);
    const particlesRef = useRef<Particle[]>([]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Get computed accent color
        const computedColor = getComputedStyle(document.documentElement)
            .getPropertyValue('--accent-500')
            .trim() || '#8b5cf6';

        const resize = () => {
            const dpr = window.devicePixelRatio || 1;
            canvas.width = canvas.offsetWidth * dpr;
            canvas.height = canvas.offsetHeight * dpr;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        };

        resize();
        window.addEventListener('resize', resize);

        // Initialize particles
        const w = canvas.offsetWidth;
        const h = canvas.offsetHeight;
        const particleCount = mode === 'premium' ? count : mode === 'balanced' ? Math.max(10, Math.round(count * 0.65)) : Math.max(6, Math.round(count * 0.4));
        const maxConnectionDistance = mode === 'premium' ? 100 : mode === 'balanced' ? 76 : 0;
        const targetFrameTime = mode === 'premium' ? 1000 / 60 : mode === 'balanced' ? 1000 / 36 : 1000 / 24;
        let lastFrame = 0;

        particlesRef.current = Array.from({ length: particleCount }, () => ({
            x: Math.random() * w,
            y: Math.random() * h,
            vx: (Math.random() - 0.5) * (mode === 'premium' ? 0.3 : 0.22),
            vy: (Math.random() - 0.5) * (mode === 'premium' ? 0.3 : 0.22),
            radius: Math.random() * 2 + 0.5,
            opacity: Math.random() * 0.4 + 0.1,
            opacityDir: Math.random() > 0.5 ? 0.002 : -0.002,
        }));

        const draw = (time: number) => {
            if (time - lastFrame < targetFrameTime) {
                animRef.current = requestAnimationFrame(draw);
                return;
            }

            lastFrame = time;
            const cw = canvas.offsetWidth;
            const ch = canvas.offsetHeight;
            ctx.clearRect(0, 0, cw, ch);

            for (const p of particlesRef.current) {
                // Move
                p.x += p.vx;
                p.y += p.vy;

                // Wrap edges
                if (p.x < 0) p.x = cw;
                if (p.x > cw) p.x = 0;
                if (p.y < 0) p.y = ch;
                if (p.y > ch) p.y = 0;

                // Pulse opacity
                p.opacity += p.opacityDir;
                if (p.opacity <= 0.05 || p.opacity >= 0.5) p.opacityDir *= -1;

                // Draw
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(${hexToRgb(computedColor)}, ${p.opacity})`;
                ctx.fill();
            }

            if (maxConnectionDistance > 0) {
                for (let i = 0; i < particlesRef.current.length; i++) {
                    for (let j = i + 1; j < particlesRef.current.length; j++) {
                        const a = particlesRef.current[i];
                        const b = particlesRef.current[j];
                        const dx = a.x - b.x;
                        const dy = a.y - b.y;
                        const dist = Math.sqrt(dx * dx + dy * dy);
                        if (dist < maxConnectionDistance) {
                            ctx.beginPath();
                            ctx.moveTo(a.x, a.y);
                            ctx.lineTo(b.x, b.y);
                            ctx.strokeStyle = `rgba(${hexToRgb(computedColor)}, ${0.06 * (1 - dist / maxConnectionDistance)})`;
                            ctx.lineWidth = 0.5;
                            ctx.stroke();
                        }
                    }
                }
            }

            animRef.current = requestAnimationFrame(draw);
        };

        animRef.current = requestAnimationFrame(draw);

        return () => {
            cancelAnimationFrame(animRef.current);
            window.removeEventListener('resize', resize);
        };
    }, [count, mode]);

    return (
        <canvas
            ref={canvasRef}
            className={className}
            style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                pointerEvents: 'none',
                zIndex: 0,
            }}
        />
    );
}

function hexToRgb(hex: string): string {
    const cleaned = hex.replace('#', '');
    if (cleaned.length === 3) {
        const r = parseInt(cleaned[0] + cleaned[0], 16);
        const g = parseInt(cleaned[1] + cleaned[1], 16);
        const b = parseInt(cleaned[2] + cleaned[2], 16);
        return `${r}, ${g}, ${b}`;
    }
    const r = parseInt(cleaned.substring(0, 2), 16);
    const g = parseInt(cleaned.substring(2, 4), 16);
    const b = parseInt(cleaned.substring(4, 6), 16);
    return `${r}, ${g}, ${b}`;
}
