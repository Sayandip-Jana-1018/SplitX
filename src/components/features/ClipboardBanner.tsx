'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { ClipboardCheck, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useClipboardPaste } from '@/hooks/useClipboardPaste';
import { PaymentIcon } from '@/components/ui/Icons';
import { formatCurrency } from '@/lib/utils';
import Button from '@/components/ui/Button';

/**
 * Floating card shown when a UPI / bank payment message is on the clipboard.
 * "Add" opens the expense composer pre-filled with the detected details.
 */
export default function ClipboardBanner() {
    const router = useRouter();
    const { detected, dismiss, accept } = useClipboardPaste();

    const handleAdd = () => {
        const result = accept();
        if (!result) return;
        const params = new URLSearchParams();
        if (result.amount) params.set('amount', String(result.amount / 100));
        if (result.merchant) params.set('title', result.merchant);
        if (result.method) params.set('method', result.method);
        params.set('source', 'clipboard');
        router.push(`/transactions/new?${params.toString()}`);
    };

    return (
        <AnimatePresence>
            {detected && (
                <motion.div
                    initial={{ y: -20, opacity: 0, scale: 0.98 }}
                    animate={{ y: 0, opacity: 1, scale: 1 }}
                    exit={{ y: -16, opacity: 0, scale: 0.98 }}
                    transition={{ type: 'spring', damping: 26, stiffness: 380 }}
                    role="status"
                    style={{
                        position: 'fixed',
                        top: 'calc(env(safe-area-inset-top, 0px) + var(--header-height) + 8px)',
                        left: 12,
                        right: 12,
                        maxWidth: 480,
                        margin: '0 auto',
                        zIndex: 1000,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        padding: '12px 12px 12px 14px',
                        borderRadius: 22,
                        background: 'var(--surface-popover)',
                        border: '1px solid rgba(var(--accent-500-rgb), 0.28)',
                        boxShadow: 'var(--shadow-xl)',
                    }}
                >
                    <span style={{
                        width: 42,
                        height: 42,
                        borderRadius: 14,
                        display: 'grid',
                        placeItems: 'center',
                        flexShrink: 0,
                        background: 'var(--accent-soft)',
                        color: 'var(--accent-strong)',
                    }}>
                        <ClipboardCheck size={20} />
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--fg-tertiary)', lineHeight: 1.3 }}>
                            Payment copied — add it as an expense?
                        </p>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2, minWidth: 0 }}>
                            <span style={{ fontWeight: 800, fontSize: 16, letterSpacing: '-0.02em', color: 'var(--fg-primary)', fontVariantNumeric: 'tabular-nums' }}>
                                {detected.amount ? formatCurrency(detected.amount) : '—'}
                            </span>
                            {detected.merchant && (
                                <span style={{ fontSize: 12.5, color: 'var(--fg-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    · {detected.merchant}
                                </span>
                            )}
                            {detected.method && <PaymentIcon method={detected.method} size={14} />}
                        </div>
                    </div>
                    <Button size="sm" onClick={handleAdd}>Add</Button>
                    <button
                        type="button"
                        onClick={dismiss}
                        aria-label="Dismiss"
                        style={{
                            width: 30,
                            height: 30,
                            borderRadius: '50%',
                            display: 'grid',
                            placeItems: 'center',
                            flexShrink: 0,
                            color: 'var(--fg-muted)',
                            background: 'var(--bg-tertiary)',
                        }}
                    >
                        <X size={14} />
                    </button>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
