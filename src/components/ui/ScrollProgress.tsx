'use client';

import { motion, useScroll, useSpring } from 'framer-motion';

/**
 * Scroll progress bar — thin accent-colored bar at top of viewport.
 * Uses Framer Motion useScroll + useSpring for smooth tracking.
 */
export default function ScrollProgress() {
    const { scrollYProgress } = useScroll();
    const scaleX = useSpring(scrollYProgress, {
        stiffness: 120,
        damping: 30,
        restDelta: 0.001,
    });

    return (
        <motion.div
            style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                height: 3,
                background: 'var(--accent-500)',
                transformOrigin: '0%',
                scaleX,
                zIndex: 10000,
                boxShadow: '0 0 10px rgba(var(--accent-500-rgb), 0.4)',
            }}
        />
    );
}
