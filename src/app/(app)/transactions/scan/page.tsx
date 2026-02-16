'use client';

import { useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Camera,
    Upload,
    ScanLine,
    Check,
    X,
    Loader2,
    ArrowLeft,
    FileText,
    Sparkles,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import { PaymentIcon, CategoryIcon, PAYMENT_ICONS } from '@/components/ui/Icons';
import { formatCurrency, cn } from '@/lib/utils';
import { parseTransactionText, type ParsedTransaction } from '@/lib/transactionParser';

type ScanState = 'idle' | 'loading' | 'result' | 'error';

export default function ScanReceiptPage() {
    const router = useRouter();
    const fileRef = useRef<HTMLInputElement>(null);
    const [scanState, setScanState] = useState<ScanState>('idle');
    const [progress, setProgress] = useState(0);
    const [parsed, setParsed] = useState<ParsedTransaction | null>(null);
    const [preview, setPreview] = useState<string | null>(null);
    const [errorMsg, setErrorMsg] = useState('');

    const handleFile = useCallback(async (file: File) => {
        if (!file.type.startsWith('image/')) {
            setErrorMsg('Please select an image file');
            setScanState('error');
            return;
        }

        // Show preview
        const reader = new FileReader();
        reader.onload = (e) => setPreview(e.target?.result as string);
        reader.readAsDataURL(file);

        setScanState('loading');
        setProgress(0);

        try {
            // Dynamic import to avoid SSR issues
            const Tesseract = await import('tesseract.js');
            const result = await Tesseract.recognize(file, 'eng', {
                logger: (m: { status: string; progress: number }) => {
                    if (m.status === 'recognizing text') {
                        setProgress(Math.round(m.progress * 100));
                    }
                },
            });

            const text = result.data.text;
            if (!text.trim()) {
                setErrorMsg('Could not extract any text. Try a clearer screenshot.');
                setScanState('error');
                return;
            }

            const parsedResult = parseTransactionText(text);
            setParsed(parsedResult);
            setScanState('result');
        } catch (err) {
            setErrorMsg('OCR processing failed. Please try again.');
            setScanState('error');
        }
    }, []);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        const file = e.dataTransfer.files?.[0];
        if (file) handleFile(file);
    }, [handleFile]);

    const reset = () => {
        setScanState('idle');
        setProgress(0);
        setParsed(null);
        setPreview(null);
        setErrorMsg('');
    };

    const confidenceColor = (c: number) =>
        c >= 0.7 ? 'var(--color-success)' : c >= 0.4 ? 'var(--color-warning)' : 'var(--color-error)';

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                <button
                    onClick={() => router.back()}
                    style={{
                        border: 'none',
                        background: 'none',
                        cursor: 'pointer',
                        color: 'var(--fg-secondary)',
                        display: 'flex',
                        padding: 4,
                    }}
                >
                    <ArrowLeft size={20} />
                </button>
                <div>
                    <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 700 }}>Scan Receipt</h2>
                    <p style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)' }}>
                        Upload a screenshot to auto-extract transaction details
                    </p>
                </div>
            </div>

            <input
                ref={fileRef}
                type="file"
                accept="image/*"
                capture="environment"
                style={{ display: 'none' }}
                onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFile(file);
                }}
            />

            <AnimatePresence mode="wait">
                {/* ── Idle State: Upload Zone ── */}
                {scanState === 'idle' && (
                    <motion.div
                        key="idle"
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -12 }}
                    >
                        <Card
                            padding="normal"
                            style={{
                                border: '2px dashed var(--border-default)',
                                textAlign: 'center',
                                cursor: 'pointer',
                                minHeight: 250,
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: 'var(--space-4)',
                            }}
                            onClick={() => fileRef.current?.click()}
                            onDragOver={(e: React.DragEvent) => e.preventDefault()}
                            onDrop={handleDrop}
                        >
                            <motion.div
                                animate={{ y: [0, -6, 0] }}
                                transition={{ repeat: Infinity, duration: 2, ease: 'easeInOut' }}
                            >
                                <ScanLine size={48} style={{ color: 'var(--accent-500)', opacity: 0.7 }} />
                            </motion.div>
                            <div>
                                <p style={{ fontWeight: 600, fontSize: 'var(--text-base)', marginBottom: 4 }}>
                                    Drop screenshot or tap to upload
                                </p>
                                <p style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)' }}>
                                    Works with GPay, PhonePe, Paytm, bank SMS screenshots
                                </p>
                            </div>
                        </Card>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)', marginTop: 'var(--space-3)' }}>
                            <Button
                                fullWidth
                                variant="outline"
                                leftIcon={<Camera size={16} />}
                                onClick={() => fileRef.current?.click()}
                            >
                                Camera
                            </Button>
                            <Button
                                fullWidth
                                variant="outline"
                                leftIcon={<Upload size={16} />}
                                onClick={() => fileRef.current?.click()}
                            >
                                Gallery
                            </Button>
                        </div>

                        {/* Supported formats */}
                        <Card padding="compact" style={{ marginTop: 'var(--space-3)' }}>
                            <p style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--fg-secondary)', marginBottom: 8 }}>
                                Supported formats
                            </p>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                {Object.entries(PAYMENT_ICONS).map(([key, val]) => (
                                    <span
                                        key={key}
                                        style={{
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: 4,
                                            fontSize: 'var(--text-xs)',
                                            color: val.color,
                                            background: `${val.color}12`,
                                            padding: '3px 8px',
                                            borderRadius: 'var(--radius-full)',
                                        }}
                                    >
                                        <PaymentIcon method={key} size={12} />
                                        {val.label}
                                    </span>
                                ))}
                            </div>
                        </Card>
                    </motion.div>
                )}

                {/* ── Loading State ── */}
                {scanState === 'loading' && (
                    <motion.div
                        key="loading"
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                    >
                        <Card padding="normal" style={{ textAlign: 'center' }}>
                            {preview && (
                                <div style={{
                                    width: '100%',
                                    maxHeight: 200,
                                    overflow: 'hidden',
                                    borderRadius: 'var(--radius-lg)',
                                    marginBottom: 'var(--space-4)',
                                    opacity: 0.5,
                                }}>
                                    <img
                                        src={preview}
                                        alt="Receipt preview"
                                        style={{ width: '100%', objectFit: 'cover' }}
                                    />
                                </div>
                            )}
                            <motion.div
                                animate={{ rotate: 360 }}
                                transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
                                style={{ display: 'inline-block', marginBottom: 'var(--space-3)' }}
                            >
                                <Loader2 size={32} style={{ color: 'var(--accent-500)' }} />
                            </motion.div>
                            <p style={{ fontWeight: 600, marginBottom: 4 }}>Scanning receipt...</p>
                            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-tertiary)', marginBottom: 'var(--space-3)' }}>
                                Running OCR on your device (nothing leaves your phone)
                            </p>
                            {/* Progress bar */}
                            <div style={{
                                width: '100%',
                                height: 6,
                                background: 'var(--bg-tertiary)',
                                borderRadius: 'var(--radius-full)',
                                overflow: 'hidden',
                            }}>
                                <motion.div
                                    style={{
                                        height: '100%',
                                        background: 'var(--accent-500)',
                                        borderRadius: 'var(--radius-full)',
                                    }}
                                    initial={{ width: '0%' }}
                                    animate={{ width: `${progress}%` }}
                                    transition={{ duration: 0.3 }}
                                />
                            </div>
                            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-muted)', marginTop: 4 }}>{progress}%</p>
                        </Card>
                    </motion.div>
                )}

                {/* ── Result State ── */}
                {scanState === 'result' && parsed && (
                    <motion.div
                        key="result"
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -12 }}
                        style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}
                    >
                        {/* Confidence badge */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                            <Sparkles size={16} style={{ color: 'var(--accent-500)' }} />
                            <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>Extracted Data</span>
                            <Badge
                                variant={parsed.confidence >= 0.7 ? 'success' : parsed.confidence >= 0.4 ? 'warning' : 'error'}
                                size="sm"
                            >
                                {Math.round(parsed.confidence * 100)}% confident
                            </Badge>
                        </div>

                        {/* Extracted fields */}
                        <Card padding="normal" glow={parsed.confidence >= 0.7}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                                {/* Amount */}
                                <div>
                                    <p style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)', marginBottom: 2 }}>Amount</p>
                                    <p style={{
                                        fontSize: 'var(--text-3xl)',
                                        fontWeight: 700,
                                        color: parsed.amount ? 'var(--fg-primary)' : 'var(--color-error)',
                                    }}>
                                        {parsed.amount ? formatCurrency(parsed.amount) : 'Not detected'}
                                    </p>
                                </div>

                                {/* Merchant */}
                                <div>
                                    <p style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)', marginBottom: 2 }}>Merchant</p>
                                    <p style={{ fontSize: 'var(--text-base)', fontWeight: 500 }}>
                                        {parsed.merchant || '—'}
                                    </p>
                                </div>

                                {/* Method + UPI Ref */}
                                <div style={{ display: 'flex', gap: 'var(--space-4)' }}>
                                    <div style={{ flex: 1 }}>
                                        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)', marginBottom: 4 }}>Method</p>
                                        {parsed.method ? (
                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                                <PaymentIcon method={parsed.method} size={18} />
                                                <span style={{ fontWeight: 500, fontSize: 'var(--text-sm)' }}>
                                                    {PAYMENT_ICONS[parsed.method]?.label || parsed.method}
                                                </span>
                                            </span>
                                        ) : (
                                            <span style={{ color: 'var(--fg-muted)', fontSize: 'var(--text-sm)' }}>—</span>
                                        )}
                                    </div>
                                    <div style={{ flex: 1 }}>
                                        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)', marginBottom: 4 }}>UPI Ref</p>
                                        <p style={{ fontSize: 'var(--text-sm)', fontWeight: 500, fontFamily: 'var(--font-mono)' }}>
                                            {parsed.upiRef || '—'}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </Card>

                        {/* Raw text preview (collapsible) */}
                        <details style={{ cursor: 'pointer' }}>
                            <summary style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)', marginBottom: 4 }}>
                                <FileText size={12} style={{ display: 'inline', marginRight: 4 }} />
                                View raw OCR text
                            </summary>
                            <Card padding="compact" style={{ marginTop: 4 }}>
                                <pre style={{
                                    fontSize: 'var(--text-xs)',
                                    color: 'var(--fg-secondary)',
                                    whiteSpace: 'pre-wrap',
                                    wordBreak: 'break-word',
                                    fontFamily: 'var(--font-mono)',
                                    maxHeight: 150,
                                    overflow: 'auto',
                                }}>
                                    {parsed.rawText}
                                </pre>
                            </Card>
                        </details>

                        {/* Actions */}
                        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                            <Button
                                fullWidth
                                leftIcon={<Check size={16} />}
                                onClick={() => {
                                    const params = new URLSearchParams();
                                    if (parsed.amount) params.set('amount', String(parsed.amount / 100));
                                    if (parsed.merchant) params.set('title', parsed.merchant);
                                    if (parsed.method) params.set('method', parsed.method);
                                    router.push(`/transactions/new?${params.toString()}`);
                                }}
                            >
                                Add as Expense
                            </Button>
                            <Button variant="outline" iconOnly onClick={reset}>
                                <X size={16} />
                            </Button>
                        </div>
                        <Button variant="ghost" fullWidth onClick={reset}>
                            Scan Another
                        </Button>
                    </motion.div>
                )}

                {/* ── Error State ── */}
                {scanState === 'error' && (
                    <motion.div
                        key="error"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                    >
                        <Card padding="normal" style={{ textAlign: 'center' }}>
                            <X size={48} style={{ color: 'var(--color-error)', marginBottom: 'var(--space-3)' }} />
                            <p style={{ fontWeight: 600, marginBottom: 4 }}>{errorMsg}</p>
                            <Button variant="outline" onClick={reset} style={{ marginTop: 'var(--space-3)' }}>
                                Try Again
                            </Button>
                        </Card>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
