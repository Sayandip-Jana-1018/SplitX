'use client';

import { CSSProperties } from 'react';

/**
 * Animated gradient background that shifts with the active palette.
 * Uses CSS @keyframes for continuous mesh gradient animation.
 */
export default function AnimatedGradient({ style }: { style?: CSSProperties }) {
    return (
        <>
            <style jsx>{`
                @keyframes gradientShift {
                    0% {
                        background-position: 0% 50%;
                    }
                    50% {
                        background-position: 100% 50%;
                    }
                    100% {
                        background-position: 0% 50%;
                    }
                }
            `}</style>
            <div
                style={{
                    position: 'absolute',
                    inset: 0,
                    background: `
                        radial-gradient(ellipse 80% 50% at 20% 40%, rgba(var(--accent-500-rgb), 0.15) 0%, transparent 70%),
                        radial-gradient(ellipse 60% 60% at 80% 20%, rgba(var(--accent-500-rgb), 0.10) 0%, transparent 60%),
                        radial-gradient(ellipse 70% 40% at 50% 80%, rgba(var(--accent-500-rgb), 0.08) 0%, transparent 60%)
                    `,
                    backgroundSize: '200% 200%',
                    animation: 'gradientShift 8s ease-in-out infinite',
                    pointerEvents: 'none',
                    zIndex: 0,
                    ...style,
                }}
            />
        </>
    );
}
