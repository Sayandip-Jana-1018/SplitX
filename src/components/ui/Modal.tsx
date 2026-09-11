'use client';

import { useCallback, useId } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, useDragControls, type PanInfo } from 'framer-motion';
import { X } from 'lucide-react';
import { useDialogFocus } from '@/hooks/useDialogFocus';
import { useIsClient, useMediaQuery } from '@/hooks/useMediaQuery';
import styles from './modal.module.css';
import { cn } from '@/lib/utils';

interface ModalProps {
    isOpen: boolean;
    onClose: () => void;
    title?: string;
    description?: string;
    size?: 'small' | 'medium' | 'large' | 'full';
    children: React.ReactNode;
    footer?: React.ReactNode;
    showCloseButton?: boolean;
    transparentOverlay?: boolean;
}

/**
 * Adaptive dialog: a draggable bottom sheet on phones,
 * a centered spring-animated dialog on larger screens.
 */
export default function Modal({
    isOpen,
    onClose,
    title,
    description,
    size = 'medium',
    children,
    footer,
    showCloseButton = true,
    transparentOverlay = false,
}: ModalProps) {
    const mounted = useIsClient();
    const isSheet = useMediaQuery('(max-width: 639px)');
    const handleClose = useCallback(() => onClose(), [onClose]);
    const dialogRef = useDialogFocus(isOpen && mounted, handleClose);
    const titleId = useId();
    const dragControls = useDragControls();

    if (!mounted) return null;

    const handleDragEnd = (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
        if (info.offset.y > 110 || info.velocity.y > 650) onClose();
    };

    const startDrag = (event: React.PointerEvent) => {
        if (isSheet) dragControls.start(event);
    };

    return createPortal(
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    key="modal-overlay"
                    className={cn(styles.overlay, isSheet && styles.overlaySheet, transparentOverlay && styles.overlayLight)}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.22 }}
                    onClick={onClose}
                >
                    <motion.div
                        ref={dialogRef}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby={title ? titleId : undefined}
                        aria-label={title ? undefined : 'Dialog'}
                        tabIndex={-1}
                        data-focus-dialog
                        className={cn(styles.modal, styles[size], isSheet && styles.sheet)}
                        initial={isSheet ? { y: '100%' } : { opacity: 0, scale: 0.96, y: 12 }}
                        animate={isSheet ? { y: 0 } : { opacity: 1, scale: 1, y: 0 }}
                        exit={isSheet ? { y: '100%' } : { opacity: 0, scale: 0.97, y: 8 }}
                        transition={{ type: 'spring', damping: 36, stiffness: 400 }}
                        drag={isSheet ? 'y' : false}
                        dragListener={false}
                        dragControls={dragControls}
                        dragConstraints={{ top: 0, bottom: 0 }}
                        dragElastic={{ top: 0, bottom: 0.7 }}
                        onDragEnd={handleDragEnd}
                        onClick={(event) => event.stopPropagation()}
                    >
                        {isSheet && (
                            <div className={styles.handleZone} onPointerDown={startDrag}>
                                <span className={styles.handle} />
                            </div>
                        )}
                        {(title || showCloseButton) && (
                            <div className={styles.header} onPointerDown={startDrag}>
                                <span className={styles.headerSpacer} />
                                {title ? <h3 id={titleId} className={styles.title}>{title}</h3> : <span />}
                                {showCloseButton ? (
                                    <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">
                                        <X size={17} />
                                    </button>
                                ) : (
                                    <span className={styles.headerSpacer} />
                                )}
                            </div>
                        )}
                        {description && <p className={styles.description}>{description}</p>}
                        <div className={styles.body}>{children}</div>
                        {footer && <div className={styles.footer}>{footer}</div>}
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>,
        document.body
    );
}
