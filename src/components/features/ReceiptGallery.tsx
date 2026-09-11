'use client';

import { useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { AnimatePresence, motion } from 'framer-motion';
import { CalendarDays, ExternalLink, ReceiptText, Tag as TagIcon, User, X } from 'lucide-react';
import { CategoryTile, getCategoryConfig } from '@/components/ui/Icons';
import { useIsClient } from '@/hooks/useMediaQuery';
import { formatCurrency } from '@/lib/utils';
import styles from './receipts.module.css';

export interface ReceiptView {
    id: string;
    title: string;
    /** paise */
    amount: number;
    category: string;
    date: string;
    imageUrl: string;
    payerName?: string | null;
}

function dayLabel(iso: string) {
    const date = new Date(iso);
    const today = new Date();
    const startOfDay = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
    const diff = Math.round((startOfDay(today) - startOfDay(date)) / 86_400_000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    return date.toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric',
    });
}

/** Receipts as photo tiles, grouped by day (newest first). */
export function ReceiptGrid({ receipts, onOpen }: { receipts: ReceiptView[]; onOpen: (receipt: ReceiptView) => void }) {
    const days = useMemo(() => {
        const sorted = [...receipts].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        const grouped = new Map<string, ReceiptView[]>();
        for (const receipt of sorted) {
            const label = dayLabel(receipt.date);
            grouped.set(label, [...(grouped.get(label) ?? []), receipt]);
        }
        return Array.from(grouped.entries());
    }, [receipts]);

    return (
        <div className={styles.days}>
            {days.map(([label, list]) => (
                <section key={label} className={styles.day}>
                    <h3 className={styles.dayLabel}>{label}</h3>
                    <div className={styles.grid}>
                        {list.map((receipt, index) => (
                            <motion.button
                                key={receipt.id}
                                type="button"
                                className={styles.tile}
                                onClick={() => onOpen(receipt)}
                                initial={{ opacity: 0, scale: 0.94 }}
                                animate={{ opacity: 1, scale: 1 }}
                                transition={{ type: 'spring', stiffness: 380, damping: 30, delay: Math.min(index, 8) * 0.035 }}
                                whileTap={{ scale: 0.97 }}
                                aria-label={`${receipt.title}, ${formatCurrency(receipt.amount)}`}
                            >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={receipt.imageUrl} alt="" loading="lazy" className={styles.tileImage} />
                                <span className={styles.tileShade} aria-hidden="true" />
                                <span className={styles.tileCategory} aria-hidden="true">
                                    <CategoryTile category={receipt.category} size={28} />
                                </span>
                                <span className={styles.tileInfo}>
                                    <span className={styles.tileTitle}>{receipt.title}</span>
                                    <span className={styles.tileAmount}>{formatCurrency(receipt.amount)}</span>
                                </span>
                            </motion.button>
                        ))}
                    </div>
                </section>
            ))}
        </div>
    );
}

export function ReceiptGridSkeleton({ count = 4 }: { count?: number }) {
    return (
        <div className={styles.grid} aria-hidden="true">
            {Array.from({ length: count }, (_, index) => (
                <span key={index} className={styles.skeletonTile} style={{ animationDelay: `${index * 120}ms` }} />
            ))}
        </div>
    );
}

/** Fullscreen photo viewer with the expense summary underneath. */
export function ReceiptViewer({ receipt, onClose }: { receipt: ReceiptView | null; onClose: () => void }) {
    const isClient = useIsClient();

    useEffect(() => {
        if (!receipt) return;
        const handleKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        window.addEventListener('keydown', handleKey);
        return () => {
            document.body.style.overflow = previousOverflow;
            window.removeEventListener('keydown', handleKey);
        };
    }, [receipt, onClose]);

    if (!isClient) return null;

    return createPortal(
        <AnimatePresence>
            {receipt && (
                <motion.div
                    key="receipt-viewer"
                    className={styles.viewer}
                    role="dialog"
                    aria-modal="true"
                    aria-label={receipt.title}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onClick={onClose}
                >
                    <div className={styles.viewerBar} onClick={(event) => event.stopPropagation()}>
                        <a href={receipt.imageUrl} target="_blank" rel="noreferrer" className={styles.viewerButton} aria-label="Open original image">
                            <ExternalLink size={17} />
                        </a>
                        <button type="button" className={styles.viewerButton} onClick={onClose} aria-label="Close">
                            <X size={19} />
                        </button>
                    </div>

                    <motion.div
                        className={styles.viewerStage}
                        initial={{ scale: 0.94, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.96, opacity: 0 }}
                        transition={{ type: 'spring', stiffness: 320, damping: 30 }}
                    >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                            src={receipt.imageUrl}
                            alt={receipt.title}
                            className={styles.viewerImage}
                            onClick={(event) => event.stopPropagation()}
                        />
                    </motion.div>

                    <motion.div
                        className={styles.viewerSheet}
                        onClick={(event) => event.stopPropagation()}
                        initial={{ y: 40, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        exit={{ y: 40, opacity: 0 }}
                        transition={{ type: 'spring', stiffness: 340, damping: 32 }}
                    >
                        <div className={styles.viewerHead}>
                            <CategoryTile category={receipt.category} size={40} />
                            <div className={styles.viewerText}>
                                <span className={styles.viewerTitle}>{receipt.title}</span>
                                <span className={styles.viewerMeta}>
                                    <span>
                                        <CalendarDays size={12} />
                                        {new Date(receipt.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                                    </span>
                                    {receipt.payerName && (
                                        <span><User size={12} />{receipt.payerName}</span>
                                    )}
                                    <span><TagIcon size={12} />{getCategoryConfig(receipt.category).label}</span>
                                </span>
                            </div>
                            <span className={styles.viewerAmount}>{formatCurrency(receipt.amount)}</span>
                        </div>
                        <Link href={`/transactions?focus=${receipt.id}`} className={styles.viewerLink} onClick={onClose}>
                            <ReceiptText size={16} />
                            View expense
                        </Link>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>,
        document.body
    );
}
