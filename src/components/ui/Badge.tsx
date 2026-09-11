'use client';

import { cn } from '@/lib/utils';

type BadgeVariant = 'default' | 'success' | 'warning' | 'error' | 'info' | 'accent';
type BadgeSize = 'sm' | 'md';

interface BadgeProps {
    children: React.ReactNode;
    variant?: BadgeVariant;
    size?: BadgeSize;
    className?: string;
}

const variantStyles: Record<BadgeVariant, React.CSSProperties> = {
    default: {
        background: 'var(--bg-tertiary)',
        color: 'var(--fg-secondary)',
    },
    success: {
        background: 'var(--color-success-bg)',
        color: 'var(--color-success)',
    },
    warning: {
        background: 'var(--color-warning-bg)',
        color: 'var(--color-warning)',
    },
    error: {
        background: 'var(--color-error-bg)',
        color: 'var(--color-error)',
    },
    info: {
        background: 'var(--color-info-bg)',
        color: 'var(--color-info)',
    },
    accent: {
        background: 'var(--accent-soft)',
        color: 'var(--accent-strong)',
    },
};

const sizeStyles: Record<BadgeSize, React.CSSProperties> = {
    sm: { height: 22, padding: '0 9px', fontSize: 11.5 },
    md: { height: 28, padding: '0 12px', fontSize: 13 },
};

export default function Badge({ children, variant = 'default', size = 'sm', className }: BadgeProps) {
    return (
        <span
            className={cn(className)}
            style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                borderRadius: 'var(--radius-full)',
                fontWeight: 600,
                whiteSpace: 'nowrap',
                lineHeight: 1,
                letterSpacing: '-0.005em',
                ...variantStyles[variant],
                ...sizeStyles[size],
            }}
        >
            {children}
        </span>
    );
}
