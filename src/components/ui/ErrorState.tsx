'use client';

import { motion } from 'framer-motion';
import { AlertTriangle, RefreshCw, WifiOff, ServerCrash } from 'lucide-react';
import Button from '@/components/ui/Button';

interface ErrorStateProps {
    title?: string;
    message?: string;
    onRetry?: () => void;
    variant?: 'default' | 'network' | 'restricted' | 'offline' | 'server' | 'empty';
}

export default function ErrorState({
    title = 'Something went wrong',
    message = 'We couldn\'t load the data. Please try again.',
    onRetry,
    variant = 'default',
}: ErrorStateProps) {
    const isNetwork = variant === 'network' || variant === 'restricted' || variant === 'offline';
    const Icon = isNetwork ? WifiOff : variant === 'server' ? ServerCrash : AlertTriangle;
    const tone = isNetwork ? 'warning' : 'error';

    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 30 }}
            role="alert"
            style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                textAlign: 'center',
                gap: 10,
                padding: '36px 24px',
                marginTop: 8,
                borderRadius: 'var(--radius-2xl)',
                background: 'var(--surface-card)',
                border: '1px solid var(--border-default)',
                boxShadow: 'var(--shadow-card)',
            }}
        >
            <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.06, type: 'spring', stiffness: 360, damping: 22 }}
                style={{
                    width: 60,
                    height: 60,
                    borderRadius: 20,
                    display: 'grid',
                    placeItems: 'center',
                    marginBottom: 4,
                    background: `var(--color-${tone}-bg)`,
                    color: `var(--color-${tone})`,
                }}
            >
                <Icon size={26} />
            </motion.div>

            <h3 style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--fg-primary)' }}>
                {title}
            </h3>

            <p style={{ maxWidth: 300, fontSize: 13.5, lineHeight: 1.55, color: 'var(--fg-tertiary)' }}>
                {message}
            </p>

            {onRetry && (
                <Button
                    variant="secondary"
                    size="md"
                    leftIcon={<RefreshCw size={15} />}
                    onClick={onRetry}
                    style={{ marginTop: 8 }}
                >
                    Try again
                </Button>
            )}
        </motion.div>
    );
}
