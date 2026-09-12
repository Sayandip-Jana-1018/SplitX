'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { Inbox, Plus } from 'lucide-react';
import Button from '@/components/ui/Button';

interface EmptyStateProps {
    icon?: React.ReactNode;
    title: string;
    description: string;
    actionLabel?: string;
    onAction?: () => void;
    actionHref?: string;
    actionIcon?: React.ReactNode;
    secondary?: React.ReactNode;
    /** 'card' renders inside a surface; 'plain' is transparent. */
    variant?: 'card' | 'plain';
    compact?: boolean;
}

/** Friendly, centered empty state with an optional call to action. */
export default function EmptyState({
    icon,
    title,
    description,
    actionLabel,
    onAction,
    actionHref,
    actionIcon,
    secondary,
    variant = 'card',
    compact = false,
}: EmptyStateProps) {
    const action = actionLabel
        ? actionHref
            ? (
                <Link href={actionHref} style={{ textDecoration: 'none' }}>
                    <Button size="md" leftIcon={actionIcon ?? <Plus size={16} />}>{actionLabel}</Button>
                </Link>
            )
            : onAction
                ? <Button size="md" onClick={onAction} leftIcon={actionIcon ?? <Plus size={16} />}>{actionLabel}</Button>
                : null
        : null;

    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 30 }}
            style={{
                position: 'relative',
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                textAlign: 'center',
                gap: 10,
                padding: compact ? '26px 20px' : '36px 24px',
                borderRadius: 'var(--radius-2xl)',
                ...(variant === 'card'
                    ? {
                        background: 'var(--surface-card)',
                        border: '1px solid var(--border-default)',
                        boxShadow: 'var(--shadow-card)',
                    }
                    : null),
            }}
        >
            {variant === 'card' && (
                <div
                    aria-hidden="true"
                    style={{
                        position: 'absolute',
                        top: -60,
                        left: '50%',
                        width: 220,
                        height: 140,
                        transform: 'translateX(-50%)',
                        background: 'radial-gradient(closest-side, rgba(var(--accent-500-rgb), 0.14), transparent)',
                        pointerEvents: 'none',
                    }}
                />
            )}
            <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1, y: [0, -6, 0] }}
                transition={{
                    delay: 0.06,
                    scale: { type: 'spring', stiffness: 360, damping: 22 },
                    opacity: { duration: 0.28 },
                    y: { duration: 4.4, repeat: Infinity, ease: 'easeInOut' },
                }}
                style={{
                    position: 'relative',
                    width: compact ? 52 : 60,
                    height: compact ? 52 : 60,
                    borderRadius: compact ? 18 : 20,
                    display: 'grid',
                    placeItems: 'center',
                    marginBottom: 4,
                    background: 'var(--accent-soft)',
                    color: 'var(--accent-strong)',
                    boxShadow: '0 0 0 6px rgba(var(--accent-500-rgb), 0.05)',
                }}
            >
                {icon || <Inbox size={compact ? 22 : 26} />}
            </motion.div>

            <h3 style={{
                position: 'relative',
                fontSize: compact ? 15 : 16,
                fontWeight: 700,
                letterSpacing: '-0.02em',
                color: 'var(--fg-primary)',
            }}>
                {title}
            </h3>

            <p style={{
                position: 'relative',
                maxWidth: 290,
                fontSize: 13.5,
                lineHeight: 1.55,
                color: 'var(--fg-tertiary)',
            }}>
                {description}
            </p>

            {(action || secondary) && (
                <div style={{ position: 'relative', display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 10, marginTop: 8 }}>
                    {action}
                    {secondary}
                </div>
            )}
        </motion.div>
    );
}
