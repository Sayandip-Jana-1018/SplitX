'use client';

import { motion } from 'framer-motion';
import { AlertTriangle, RefreshCw, WifiOff } from 'lucide-react';
import Button from '@/components/ui/Button';

interface ErrorStateProps {
    title?: string;
    message?: string;
    onRetry?: () => void;
    variant?: 'default' | 'network' | 'empty';
}

export default function ErrorState({
    title = 'Something went wrong',
    message = 'We couldn\'t load the data. Please try again.',
    onRetry,
    variant = 'default',
}: ErrorStateProps) {
    const Icon = variant === 'network' ? WifiOff : AlertTriangle;
    const iconColor = variant === 'network' ? 'var(--color-warning)' : 'var(--color-error)';

    return (
        <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                textAlign: 'center',
                padding: 'var(--space-8) var(--space-4)',
                gap: 'var(--space-3)',
                minHeight: 200,
            }}
        >
            <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.1, type: 'spring', stiffness: 300 }}
                style={{
                    width: 56,
                    height: 56,
                    borderRadius: '50%',
                    background: `color-mix(in srgb, ${iconColor} 12%, transparent)`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                }}
            >
                <Icon size={28} style={{ color: iconColor }} />
            </motion.div>

            <h3 style={{
                fontWeight: 600,
                fontSize: 'var(--text-base)',
                color: 'var(--fg-primary)',
            }}>
                {title}
            </h3>

            <p style={{
                fontSize: 'var(--text-sm)',
                color: 'var(--fg-tertiary)',
                maxWidth: 280,
                lineHeight: 1.5,
            }}>
                {message}
            </p>

            {onRetry && (
                <Button
                    variant="outline"
                    size="sm"
                    leftIcon={<RefreshCw size={14} />}
                    onClick={onRetry}
                    style={{ marginTop: 'var(--space-2)' }}
                >
                    Try Again
                </Button>
            )}
        </motion.div>
    );
}
