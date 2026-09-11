'use client';

import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence, type PanInfo } from 'framer-motion';
import { X, CheckCircle2, AlertCircle, AlertTriangle, Info } from 'lucide-react';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
    id: string;
    message: string;
    type: ToastType;
    duration?: number;
    action?: { label: string; onClick: () => void };
}

interface ToastContextValue {
    toast: (message: string, type?: ToastType, options?: { duration?: number; action?: Toast['action'] }) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
    const ctx = useContext(ToastContext);
    if (!ctx) throw new Error('useToast must be used within ToastProvider');
    return ctx;
}

const ICONS: Record<ToastType, React.ReactNode> = {
    success: <CheckCircle2 size={17} />,
    error: <AlertCircle size={17} />,
    warning: <AlertTriangle size={17} />,
    info: <Info size={17} />,
};

const TONES: Record<ToastType, { fg: string; bg: string }> = {
    success: { fg: 'var(--color-success)', bg: 'var(--color-success-bg)' },
    error: { fg: 'var(--color-error)', bg: 'var(--color-error-bg)' },
    warning: { fg: 'var(--color-warning)', bg: 'var(--color-warning-bg)' },
    info: { fg: 'var(--accent-strong)', bg: 'var(--accent-soft)' },
};

let toastCounter = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
    const [toasts, setToasts] = useState<Toast[]>([]);

    const addToast = useCallback(
        (message: string, type: ToastType = 'info', options?: { duration?: number; action?: Toast['action'] }) => {
            toastCounter += 1;
            const id = `toast-${toastCounter}`;
            setToasts((prev) => [...prev.slice(-2), { id, message, type, duration: options?.duration ?? 3800, action: options?.action }]);
        },
        []
    );

    const removeToast = useCallback((id: string) => {
        setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, []);

    return (
        <ToastContext.Provider value={{ toast: addToast }}>
            {children}
            <div
                aria-live="polite"
                style={{
                    position: 'fixed',
                    top: 'calc(env(safe-area-inset-top, 0px) + 12px)',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    zIndex: 'var(--z-toast)' as unknown as number,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 8,
                    width: 'min(calc(100vw - 24px), 420px)',
                    pointerEvents: 'none',
                }}
            >
                <AnimatePresence mode="popLayout" initial={false}>
                    {toasts.map((toast) => (
                        <ToastItem key={toast.id} toast={toast} onDismiss={() => removeToast(toast.id)} />
                    ))}
                </AnimatePresence>
            </div>
        </ToastContext.Provider>
    );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
    useEffect(() => {
        if (toast.duration && toast.duration > 0) {
            const timer = setTimeout(onDismiss, toast.duration);
            return () => clearTimeout(timer);
        }
    }, [toast.duration, onDismiss]);

    const tone = TONES[toast.type];

    const handleDragEnd = (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
        if (info.offset.y < -24 || Math.abs(info.offset.x) > 80) onDismiss();
    };

    return (
        <motion.div
            layout
            role={toast.type === 'error' ? 'alert' : 'status'}
            initial={{ opacity: 0, y: -24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -16, scale: 0.96, transition: { duration: 0.18 } }}
            transition={{ type: 'spring', damping: 26, stiffness: 380 }}
            drag
            dragConstraints={{ top: 0, bottom: 0, left: 0, right: 0 }}
            dragElastic={0.5}
            onDragEnd={handleDragEnd}
            style={{
                pointerEvents: 'auto',
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '10px 10px 10px 12px',
                borderRadius: 18,
                background: 'var(--surface-popover)',
                border: '1px solid var(--border-default)',
                boxShadow: 'var(--shadow-lg)',
                touchAction: 'none',
            }}
        >
            <span
                style={{
                    width: 32,
                    height: 32,
                    borderRadius: 11,
                    display: 'grid',
                    placeItems: 'center',
                    flexShrink: 0,
                    color: tone.fg,
                    background: tone.bg,
                }}
            >
                {ICONS[toast.type]}
            </span>
            <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, lineHeight: 1.4, fontWeight: 600, color: 'var(--fg-primary)' }}>
                {toast.message}
            </span>
            {toast.action && (
                <button
                    type="button"
                    onClick={() => { toast.action!.onClick(); onDismiss(); }}
                    style={{
                        height: 32,
                        padding: '0 12px',
                        borderRadius: 999,
                        fontSize: 13,
                        fontWeight: 700,
                        color: 'var(--accent-strong)',
                        background: 'var(--accent-soft)',
                        whiteSpace: 'nowrap',
                    }}
                >
                    {toast.action.label}
                </button>
            )}
            <button
                type="button"
                onClick={onDismiss}
                aria-label="Dismiss"
                style={{
                    width: 28,
                    height: 28,
                    borderRadius: '50%',
                    display: 'grid',
                    placeItems: 'center',
                    flexShrink: 0,
                    color: 'var(--fg-muted)',
                }}
            >
                <X size={15} />
            </button>
        </motion.div>
    );
}
