'use client';

import { type ReactNode } from 'react';
import { motion } from 'framer-motion';

/**
 * Scroll-reveal wrapper for landing sections: content rises and fades in once,
 * the first time it enters the viewport. Transform + opacity only, so it stays
 * on the compositor.
 */
export default function Reveal({
    children,
    delay = 0,
    y = 34,
    className,
}: {
    children: ReactNode;
    delay?: number;
    y?: number;
    className?: string;
}) {
    return (
        <motion.div
            className={className}
            initial={{ opacity: 0, y }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-90px' }}
            transition={{ duration: 0.75, delay, ease: [0.22, 1, 0.36, 1] }}
        >
            {children}
        </motion.div>
    );
}
