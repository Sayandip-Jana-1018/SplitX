'use client';

import { useEffect, useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import styles from './modal.module.css';
import { cn } from '@/lib/utils';

interface ModalProps {
    isOpen: boolean;
    onClose: () => void;
    title?: string;
    size?: 'small' | 'medium' | 'large' | 'full';
    children: React.ReactNode;
    footer?: React.ReactNode;
    showCloseButton?: boolean;
    transparentOverlay?: boolean;
}

export default function Modal({
    isOpen,
    onClose,
    title,
    size = 'medium',
    children,
    footer,
    showCloseButton = true,
    transparentOverlay = false,
}: ModalProps) {
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    // Close on Escape
    const handleKeyDown = useCallback(
        (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        },
        [onClose]
    );

    useEffect(() => {
        if (isOpen) {
            document.addEventListener('keydown', handleKeyDown);
            document.body.style.overflow = 'hidden';
        }
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            document.body.style.overflow = '';
        };
    }, [isOpen, handleKeyDown]);

    if (!mounted) return null;

    return createPortal(
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    className={styles.overlay}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    onClick={onClose}
                    style={transparentOverlay ? { background: 'transparent', backdropFilter: 'none' } : undefined}
                >
                    <motion.div
                        className={cn(styles.modal, styles[size])}
                        initial={{ opacity: 0, scale: 0.95, y: 10 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 10 }}
                        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        {(title || showCloseButton) && (
                            <div className={styles.header}>
                                {title && <h3 className={styles.title}>{title}</h3>}
                                {showCloseButton && (
                                    <button className={styles.closeBtn} onClick={onClose} aria-label="Close">
                                        <X size={18} />
                                    </button>
                                )}
                            </div>
                        )}
                        <div className={styles.body}>{children}</div>
                        {footer && <div className={styles.footer}>{footer}</div>}
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>,
        document.body
    );
}

