'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Camera,
    Upload,
    ScanLine,
    Check,
    X,
    Loader2,
    FileText,
    Sparkles,
    ShieldCheck,
    RotateCcw,
    Smartphone,
    ImageIcon,
    Zap,
    Cpu,
    Globe,
    Users,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import { PaymentIcon, CategoryIcon, PAYMENT_ICONS } from '@/components/ui/Icons';
import { formatCurrency, cn } from '@/lib/utils';
import { parseTransactionText, type ParsedTransaction } from '@/lib/transactionParser';
import SplitByItems from '@/components/features/SplitByItems';

type ScanState = 'idle' | 'loading' | 'result' | 'error';
type ScanMode = 'basic' | 'advanced';

interface AdvancedResult {
    merchant: string | null;
    date: string | null;
    items: { name: string; quantity: number; price: number }[];
    subtotal: number;
    taxes: Record<string, number>;
    total: number;
    category: string;
    confidence: number;
}

/* ── Premium glass styles ── */
const glass = {
    background: 'var(--bg-glass)',
    border: '1px solid var(--border-glass)',
};

/* ── Animation variants ── */
const fadeUp = {
    initial: { opacity: 0, y: 20 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -12 },
};

const scaleIn = {
    initial: { opacity: 0, scale: 0.92 },
    animate: { opacity: 1, scale: 1 },
    exit: { opacity: 0, scale: 0.95 },
};

const stagger = {
    animate: { transition: { staggerChildren: 0.06 } },
};

const staggerItem = {
    initial: { opacity: 0, y: 12 },
    animate: { opacity: 1, y: 0 },
};

export default function ScanReceiptPage() {
    const router = useRouter();
    const cameraRef = useRef<HTMLInputElement>(null);
    const galleryRef = useRef<HTMLInputElement>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const [scanState, setScanState] = useState<ScanState>('idle');
    const [progress, setProgress] = useState(0);
    const [parsed, setParsed] = useState<ParsedTransaction | null>(null);
    const [advancedResult, setAdvancedResult] = useState<AdvancedResult | null>(null);
    const [preview, setPreview] = useState<string | null>(null);
    const [errorMsg, setErrorMsg] = useState('');
    const [saving, setSaving] = useState(false);
    const [showCamera, setShowCamera] = useState(false);
    const [scanMode, setScanMode] = useState<ScanMode>('basic');
    const [mounted, setMounted] = useState(false);
    const pendingFileRef = useRef<string | null>(null); // base64 for advanced
    const [showSplitByItems, setShowSplitByItems] = useState(false);

    useEffect(() => { setMounted(true); }, []);

    /* ── Live Camera via getUserMedia ── */
    const openLiveCamera = useCallback(async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'environment', width: { ideal: 1080 }, height: { ideal: 1920 } },
            });
            streamRef.current = stream;
            setShowCamera(true);
            // Wait for video element to mount, then attach stream
            requestAnimationFrame(() => {
                if (videoRef.current) {
                    videoRef.current.srcObject = stream;
                    videoRef.current.play().catch(() => { });
                }
            });
        } catch {
            // getUserMedia not available — fall back to file input
            cameraRef.current?.click();
        }
    }, []);

    const captureFrame = useCallback(() => {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        if (!video || !canvas) return;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(video, 0, 0);
        canvas.toBlob((blob) => {
            if (blob) {
                const file = new File([blob], 'camera-capture.jpg', { type: 'image/jpeg' });
                closeCamera();
                handleFile(file);
            }
        }, 'image/jpeg', 0.92);
    }, []);

    const closeCamera = useCallback(() => {
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(t => t.stop());
            streamRef.current = null;
        }
        setShowCamera(false);
    }, []);

    const handleFile = useCallback(async (file: File) => {
        if (!file.type.startsWith('image/')) {
            setErrorMsg('Please select an image file (JPG, PNG, etc.)');
            setScanState('error');
            return;
        }

        // File size check (max 15MB)
        if (file.size > 15 * 1024 * 1024) {
            setErrorMsg('Image too large. Please use an image under 15MB.');
            setScanState('error');
            return;
        }

        // Show preview
        const reader = new FileReader();
        reader.onload = (e) => {
            const base64 = e.target?.result as string;
            setPreview(base64);
            pendingFileRef.current = base64;
        };
        reader.readAsDataURL(file);

        if (scanMode === 'advanced') {
            // Wait for reader to finish, then call API
            reader.onloadend = () => {
                handleAdvancedScan(reader.result as string);
            };
        } else {
            setScanState('loading');
            setProgress(0);

            try {
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
                    setErrorMsg('Could not extract any text from this image. Try a clearer screenshot with better lighting.');
                    setScanState('error');
                    return;
                }

                const parsedResult = parseTransactionText(text);
                setParsed(parsedResult);
                setScanState('result');
            } catch (err) {
                console.error('OCR Error:', err);
                setErrorMsg('OCR processing failed. Check your connection and try again.');
                setScanState('error');
            }
        }
    }, [scanMode]);

    const handleAdvancedScan = async (base64Image: string) => {
        setScanState('loading');
        setProgress(0);
        // Simulate progress for better UX
        const progressInterval = setInterval(() => {
            setProgress(p => Math.min(p + 3, 90));
        }, 300);

        try {
            const res = await fetch('/api/receipt-scan', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ image: base64Image }),
            });

            clearInterval(progressInterval);
            setProgress(100);

            if (!res.ok) {
                const err = await res.json();
                setErrorMsg(err.error || 'Advanced scan failed. Please try again.');
                setScanState('error');
                return;
            }

            const data: AdvancedResult = await res.json();
            setAdvancedResult(data);
            setScanState('result');
        } catch (err) {
            clearInterval(progressInterval);
            console.error('Advanced scan error:', err);
            setErrorMsg('Failed to connect to AI service. Check your connection and try again.');
            setScanState('error');
        }
    };

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        const file = e.dataTransfer.files?.[0];
        if (file) handleFile(file);
    }, [handleFile]);

    const reset = () => {
        setScanState('idle');
        setProgress(0);
        setParsed(null);
        setAdvancedResult(null);
        setPreview(null);
        setErrorMsg('');
        pendingFileRef.current = null;
        if (cameraRef.current) cameraRef.current.value = '';
        if (galleryRef.current) galleryRef.current.value = '';
    };

    const handleSaveToExpense = async () => {
        setSaving(true);
        const params = new URLSearchParams();
        if (scanMode === 'advanced' && advancedResult) {
            if (advancedResult.total) params.set('amount', String(advancedResult.total / 100));
            if (advancedResult.merchant) params.set('title', advancedResult.merchant);
            if (advancedResult.category) params.set('category', advancedResult.category);
            params.set('method', 'cash');
        } else if (parsed) {
            if (parsed.amount) params.set('amount', String(parsed.amount / 100));
            if (parsed.merchant) params.set('title', parsed.merchant);
            if (parsed.method) params.set('method', parsed.method);
        }
        router.push(`/transactions/new?${params.toString()}`);
    };

    const confidenceLabel = (c: number) =>
        c >= 0.7 ? 'High' : c >= 0.4 ? 'Medium' : 'Low';
    const confidenceVariant = (c: number): 'success' | 'warning' | 'error' =>
        c >= 0.7 ? 'success' : c >= 0.4 ? 'warning' : 'error';

    const STEPS = [
        { icon: '📸', text: 'Take photo or pick from gallery' },
        { icon: '🔍', text: 'AI extracts amount, merchant & method' },
        { icon: '✅', text: 'Review & save as expense' },
    ];

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', maxWidth: 500, width: '100%', margin: '0 auto' }}>
            {/* ── Hidden file inputs: separate for Camera (with capture) and Gallery (without capture) ── */}
            <input
                ref={cameraRef}
                type="file"
                accept="image/*"
                capture="environment"
                style={{ display: 'none' }}
                onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFile(file);
                }}
            />
            <input
                ref={galleryRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFile(file);
                }}
            />

            <AnimatePresence mode="wait">
                {/* ═══════════════════════════════════════════ */}
                {/* ═══ IDLE STATE — Premium Upload Zone ═══ */}
                {/* ═══════════════════════════════════════════ */}
                {scanState === 'idle' && (
                    <motion.div
                        key="idle"
                        {...fadeUp}
                        style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}
                    >

                        {/* ── Hero Upload Zone ── */}
                        <motion.div
                            whileHover={{ scale: 1.01 }}
                            whileTap={{ scale: 0.98 }}
                            onClick={openLiveCamera}
                            onDragOver={(e: React.DragEvent) => e.preventDefault()}
                            onDrop={handleDrop}
                            style={{
                                ...glass,
                                borderRadius: 'var(--radius-2xl)',
                                border: '2px dashed rgba(var(--accent-500-rgb), 0.25)',
                                padding: 'var(--space-8) var(--space-4)',
                                textAlign: 'center',
                                cursor: 'pointer',
                                position: 'relative',
                                overflow: 'hidden',
                                minHeight: 220,
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: 'var(--space-3)',
                            }}
                        >
                            {/* Gradient mesh overlay */}
                            <div style={{
                                position: 'absolute', inset: 0, borderRadius: 'inherit',
                                background: 'radial-gradient(ellipse 80% 60% at 50% 20%, rgba(var(--accent-500-rgb), 0.06) 0%, transparent 70%)',
                                pointerEvents: 'none',
                            }} />
                            {/* Top shimmer */}
                            <div style={{
                                position: 'absolute', top: 0, left: '20%', right: '20%', height: 1,
                                background: 'linear-gradient(90deg, transparent, rgba(var(--accent-500-rgb), 0.2), transparent)',
                                pointerEvents: 'none',
                            }} />

                            {/* ── Toggle (Inside) ── */}
                            <div style={{
                                display: 'flex', gap: 4, background: 'rgba(var(--accent-500-rgb), 0.08)',
                                padding: 4, borderRadius: 'var(--radius-full)', marginBottom: 'var(--space-2)',
                                border: '1px solid rgba(var(--accent-500-rgb), 0.1)',
                                position: 'relative', zIndex: 10
                            }} onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
                                {(['basic', 'advanced'] as const).map((mode) => (
                                    <button
                                        key={mode}
                                        onClick={() => setScanMode(mode)}
                                        style={{
                                            padding: '6px 16px', borderRadius: 'var(--radius-full)', border: 'none',
                                            background: scanMode === mode ? 'var(--accent-500)' : 'transparent',
                                            color: scanMode === mode ? 'white' : 'var(--fg-secondary)',
                                            fontSize: 'var(--text-xs)', fontWeight: 600, cursor: 'pointer',
                                            boxShadow: scanMode === mode ? '0 2px 8px rgba(var(--accent-500-rgb), 0.3)' : 'none',
                                            transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: 6
                                        }}
                                    >
                                        {mode === 'basic' ? '⚡ Basic' : '✨ AI Scan'}
                                    </button>
                                ))}
                            </div>

                            {/* Mode description text */}
                            <div style={{
                                fontSize: '10px', color: 'var(--fg-muted)', opacity: 0.8,
                                marginBottom: 8, marginTop: -4, textAlign: 'center', maxWidth: 220
                            }}>
                                {scanMode === 'basic'
                                    ? '🔒 On-device OCR • Fast • No internet needed'
                                    : '🧠 OpenAI Vision AI • Accurate items & taxes'}
                            </div>

                            <motion.div
                                animate={{ y: [0, -8, 0] }}
                                transition={{ repeat: Infinity, duration: 2.5, ease: 'easeInOut' }}
                                style={{
                                    width: 72, height: 72, borderRadius: 'var(--radius-xl)',
                                    background: 'linear-gradient(135deg, rgba(var(--accent-500-rgb), 0.15), rgba(var(--accent-500-rgb), 0.05))',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    border: '1px solid rgba(var(--accent-500-rgb), 0.15)',
                                }}
                            >
                                <ScanLine size={32} style={{ color: 'var(--accent-400)' }} />
                            </motion.div>
                            <div style={{ position: 'relative', zIndex: 1 }}>
                                <p style={{
                                    fontWeight: 700, fontSize: 'var(--text-base)',
                                    marginBottom: 4, color: 'var(--fg-primary)',
                                }}>
                                    Drop or tap to scan
                                </p>
                                <p style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)', lineHeight: 1.5 }}>
                                    GPay · PhonePe · Paytm · Bank SMS · UPI receipts
                                </p>
                            </div>
                        </motion.div>

                        {/* ── Camera & Gallery Buttons ── */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
                            <motion.button
                                whileHover={{ scale: 1.03 }}
                                whileTap={{ scale: 0.95 }}
                                onClick={openLiveCamera}
                                style={{
                                    ...glass,
                                    borderRadius: 'var(--radius-xl)',
                                    padding: 'var(--space-4)',
                                    display: 'flex', flexDirection: 'column',
                                    alignItems: 'center', gap: 'var(--space-2)',
                                    cursor: 'pointer', border: '1px solid rgba(var(--accent-500-rgb), 0.12)',
                                    background: 'linear-gradient(135deg, rgba(var(--accent-500-rgb), 0.06), var(--bg-glass))',
                                }}
                            >
                                <div style={{
                                    width: 44, height: 44, borderRadius: 'var(--radius-lg)',
                                    background: 'linear-gradient(135deg, var(--accent-500), var(--accent-600))',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    boxShadow: '0 4px 14px rgba(var(--accent-500-rgb), 0.3)',
                                }}>
                                    <Camera size={20} style={{ color: 'white' }} />
                                </div>
                                <span style={{ fontWeight: 600, fontSize: 'var(--text-sm)', color: 'var(--fg-primary)' }}>Camera</span>
                                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)' }}>Take a photo</span>
                            </motion.button>

                            <motion.button
                                whileHover={{ scale: 1.03 }}
                                whileTap={{ scale: 0.95 }}
                                onClick={() => galleryRef.current?.click()}
                                style={{
                                    ...glass,
                                    borderRadius: 'var(--radius-xl)',
                                    padding: 'var(--space-4)',
                                    display: 'flex', flexDirection: 'column',
                                    alignItems: 'center', gap: 'var(--space-2)',
                                    cursor: 'pointer', border: '1px solid rgba(var(--accent-500-rgb), 0.12)',
                                    background: 'linear-gradient(135deg, rgba(56, 189, 248, 0.06), var(--bg-glass))',
                                }}
                            >
                                <div style={{
                                    width: 44, height: 44, borderRadius: 'var(--radius-lg)',
                                    background: 'linear-gradient(135deg, #38bdf8, #0ea5e9)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    boxShadow: '0 4px 14px rgba(56, 189, 248, 0.3)',
                                }}>
                                    <ImageIcon size={20} style={{ color: 'white' }} />
                                </div>
                                <span style={{ fontWeight: 600, fontSize: 'var(--text-sm)', color: 'var(--fg-primary)' }}>Gallery</span>
                                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)' }}>Pick a screenshot</span>
                            </motion.button>
                        </div>

                        {/* ── How it works ── */}
                        <motion.div variants={stagger} initial="initial" animate="animate">
                            <div style={{
                                ...glass,
                                borderRadius: 'var(--radius-xl)',
                                padding: 'var(--space-4)',
                            }}>
                                <div style={{
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 'var(--space-3)',
                                }}>
                                    <Zap size={14} style={{ color: 'var(--accent-400)' }} />
                                    <span style={{
                                        fontSize: 'var(--text-xs)', fontWeight: 700,
                                        textTransform: 'uppercase', letterSpacing: '0.05em',
                                        color: 'var(--accent-400)',
                                    }}>How it works</span>
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                                    {STEPS.map((step, i) => (
                                        <motion.div
                                            key={i}
                                            variants={staggerItem}
                                            style={{
                                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-3)',
                                            }}
                                        >
                                            <div style={{
                                                width: 32, height: 32, borderRadius: 'var(--radius-lg)',
                                                background: 'rgba(var(--accent-500-rgb), 0.08)',
                                                border: '1px solid rgba(var(--accent-500-rgb), 0.1)',
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                fontSize: '14px', flexShrink: 0,
                                            }}>
                                                {step.icon}
                                            </div>
                                            <span style={{
                                                fontSize: 'var(--text-sm)', color: 'var(--fg-secondary)',
                                                fontWeight: 500,
                                            }}>
                                                {step.text}
                                            </span>
                                        </motion.div>
                                    ))}
                                </div>
                            </div>
                        </motion.div>

                        {/* ── Supported Formats as pills ── */}
                        <div style={{
                            ...glass,
                            borderRadius: 'var(--radius-xl)',
                            padding: 'var(--space-4)',
                        }}>
                            <div style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 'var(--space-3)',
                            }}>
                                <ShieldCheck size={14} style={{ color: 'var(--color-success)' }} />
                                <span style={{
                                    fontSize: 'var(--text-xs)', fontWeight: 700,
                                    textTransform: 'uppercase', letterSpacing: '0.05em',
                                    color: 'var(--fg-tertiary)',
                                }}>Supported Formats</span>
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
                                {Object.entries(PAYMENT_ICONS).map(([key, val]) => (
                                    <span
                                        key={key}
                                        style={{
                                            display: 'inline-flex', alignItems: 'center', gap: 6,
                                            fontSize: 'var(--text-xs)', fontWeight: 600,
                                            color: val.color,
                                            background: `${val.color}10`,
                                            padding: '6px 12px',
                                            borderRadius: 'var(--radius-full)',
                                            border: `1px solid ${val.color}20`,
                                        }}
                                    >
                                        <PaymentIcon method={key} size={14} />
                                        {val.label}
                                    </span>
                                ))}
                            </div>
                        </div>

                        {/* ── Privacy Note ── */}
                        <div style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            gap: 6, padding: 'var(--space-2)',
                        }}>
                            <ShieldCheck size={12} style={{ color: 'var(--color-success)', flexShrink: 0 }} />
                            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-muted)' }}>
                                {scanMode === 'basic'
                                    ? 'All processing happens on your device — nothing leaves your phone'
                                    : 'Image is sent securely to OpenAI for processing'}
                            </span>
                        </div>
                    </motion.div>
                )}

                {/* ═══════════════════════════════════════════ */}
                {/* ═══ LOADING STATE — Premium Scanner ═══ */}
                {/* ═══════════════════════════════════════════ */}
                {scanState === 'loading' && (
                    <motion.div key="loading" {...scaleIn}>
                        <div style={{
                            ...glass,
                            borderRadius: 'var(--radius-2xl)',
                            padding: 'var(--space-5)',
                            textAlign: 'center',
                            overflow: 'hidden',
                            position: 'relative',
                        }}>
                            {/* Image preview with scan line overlay */}
                            {preview && (
                                <div style={{
                                    position: 'relative',
                                    width: '100%', maxHeight: 200,
                                    overflow: 'hidden',
                                    borderRadius: 'var(--radius-xl)',
                                    marginBottom: 'var(--space-4)',
                                }}>
                                    <img
                                        src={preview}
                                        alt="Receipt preview"
                                        style={{
                                            width: '100%', objectFit: 'cover',
                                            filter: 'brightness(0.7)',
                                        }}
                                    />
                                    {/* Animated scan line */}
                                    <motion.div
                                        animate={{ top: ['0%', '90%', '0%'] }}
                                        transition={{ repeat: Infinity, duration: 2.5, ease: 'easeInOut' }}
                                        style={{
                                            position: 'absolute', left: '5%', right: '5%',
                                            height: 3,
                                            background: 'linear-gradient(90deg, transparent, var(--accent-400), var(--accent-500), var(--accent-400), transparent)',
                                            borderRadius: 2,
                                            boxShadow: '0 0 20px var(--accent-500), 0 0 60px rgba(var(--accent-500-rgb), 0.3)',
                                        }}
                                    />
                                    {/* Corner brackets */}
                                    <div style={{
                                        position: 'absolute', inset: 12,
                                        border: '2px solid rgba(var(--accent-500-rgb), 0.4)',
                                        borderRadius: 'var(--radius-lg)',
                                        pointerEvents: 'none',
                                    }} />
                                </div>
                            )}

                            {/* Spinner */}
                            <motion.div
                                animate={{ rotate: 360 }}
                                transition={{ repeat: Infinity, duration: 1.2, ease: 'linear' }}
                                style={{ display: 'inline-block', marginBottom: 'var(--space-3)' }}
                            >
                                <Loader2 size={28} style={{ color: 'var(--accent-400)' }} />
                            </motion.div>
                            <p style={{
                                fontWeight: 700, fontSize: 'var(--text-base)',
                                marginBottom: 4, color: 'var(--fg-primary)',
                            }}>
                                Scanning your receipt...
                            </p>
                            <p style={{
                                fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)',
                                marginBottom: 'var(--space-4)',
                            }}>
                                {scanMode === 'advanced'
                                    ? 'AI Vision is analyzing items, taxes & totals'
                                    : 'AI is reading text from your image'}
                            </p>

                            {/* Premium progress bar */}
                            <div style={{
                                width: '100%', height: 8,
                                background: 'rgba(var(--accent-500-rgb), 0.08)',
                                borderRadius: 'var(--radius-full)',
                                overflow: 'hidden',
                                position: 'relative',
                            }}>
                                <motion.div
                                    style={{
                                        height: '100%',
                                        background: 'linear-gradient(90deg, var(--accent-600), var(--accent-400), var(--accent-500))',
                                        borderRadius: 'var(--radius-full)',
                                        boxShadow: '0 0 12px rgba(var(--accent-500-rgb), 0.4)',
                                    }}
                                    initial={{ width: '0%' }}
                                    animate={{ width: `${progress}%` }}
                                    transition={{ duration: 0.3, ease: 'easeOut' }}
                                />
                            </div>
                            <p style={{
                                fontSize: 'var(--text-xs)', color: 'var(--accent-400)',
                                marginTop: 8, fontWeight: 600,
                            }}>
                                {progress}% complete
                            </p>
                        </div>
                    </motion.div>
                )}

                {/* ═══════════════════════════════════════════ */}
                {/* ═══ RESULT STATE — Premium Data Card ═══ */}
                {/* ═══════════════════════════════════════════ */}
                {scanState === 'result' && (scanMode === 'basic' ? parsed : advancedResult) && (
                    <motion.div
                        key="result"
                        {...fadeUp}
                        style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}
                    >
                        {/* ── Confidence Banner ── */}
                        <motion.div
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            style={{
                                ...glass,
                                borderRadius: 'var(--radius-xl)',
                                padding: 'var(--space-3) var(--space-4)',
                                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            }}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <Sparkles size={16} style={{ color: 'var(--accent-400)' }} />
                                <span style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--fg-primary)' }}>
                                    {scanMode === 'advanced' ? 'AI Vision Result' : 'Extracted Data'}
                                </span>
                            </div>
                            <Badge variant={confidenceVariant(
                                scanMode === 'advanced' ? (advancedResult?.confidence || 0) : (parsed?.confidence || 0)
                            )} size="sm">
                                {confidenceLabel(
                                    scanMode === 'advanced' ? (advancedResult?.confidence || 0) : (parsed?.confidence || 0)
                                )} · {Math.round(
                                    (scanMode === 'advanced' ? (advancedResult?.confidence || 0) : (parsed?.confidence || 0)) * 100
                                )}%
                            </Badge>
                        </motion.div>

                        {/* ═══ ADVANCED RESULT ═══ */}
                        {scanMode === 'advanced' && advancedResult && (
                            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
                                <div style={{ ...glass, borderRadius: 'var(--radius-2xl)', overflow: 'hidden', boxShadow: '0 0 30px rgba(var(--accent-500-rgb), 0.1), var(--shadow-card)', position: 'relative' }}>
                                    <div style={{ position: 'absolute', top: 0, left: '10%', right: '10%', height: 1, background: 'linear-gradient(90deg, transparent, rgba(var(--accent-500-rgb), 0.3), transparent)', pointerEvents: 'none' }} />
                                    {/* Merchant & Date */}
                                    <div style={{ padding: 'var(--space-5) var(--space-4) var(--space-3)', background: 'linear-gradient(135deg, rgba(var(--accent-500-rgb), 0.06), transparent)', textAlign: 'center' }}>
                                        <p style={{ fontSize: 'var(--text-lg)', fontWeight: 800, color: 'var(--fg-primary)', marginBottom: 4 }}>
                                            {advancedResult.merchant || 'Receipt'}
                                        </p>
                                        {advancedResult.date && (
                                            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)', fontWeight: 500 }}>{advancedResult.date}</p>
                                        )}
                                    </div>
                                    {/* Items */}
                                    {advancedResult.items.length > 0 && (
                                        <div style={{ padding: '0 var(--space-4)' }}>
                                            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--fg-tertiary)', padding: 'var(--space-2) 0', borderBottom: '1px solid var(--border-glass)', display: 'flex', justifyContent: 'space-between' }}>
                                                <span>Item</span><span>Price</span>
                                            </div>
                                            {advancedResult.items.map((item, idx) => (
                                                <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: idx < advancedResult.items.length - 1 ? '1px solid rgba(var(--accent-500-rgb), 0.05)' : 'none' }}>
                                                    <div style={{ flex: 1 }}>
                                                        <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--fg-primary)' }}>{item.name}</span>
                                                        {item.quantity > 1 && <span style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)', marginLeft: 6 }}>×{item.quantity}</span>}
                                                    </div>
                                                    <span style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--fg-primary)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', marginLeft: 12 }}>
                                                        {formatCurrency(item.price * item.quantity)}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    {/* Subtotal, Taxes, Total */}
                                    <div style={{ padding: 'var(--space-3) var(--space-4) var(--space-4)', borderTop: '1px solid var(--border-glass)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                                        {advancedResult.subtotal > 0 && (
                                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)', fontWeight: 500 }}>Subtotal</span>
                                                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-secondary)', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{formatCurrency(advancedResult.subtotal)}</span>
                                            </div>
                                        )}
                                        {Object.entries(advancedResult.taxes).map(([taxName, taxAmount]) => (
                                            <div key={taxName} style={{ display: 'flex', justifyContent: 'space-between' }}>
                                                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)', fontWeight: 500 }}>{taxName}</span>
                                                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-secondary)', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{formatCurrency(taxAmount)}</span>
                                            </div>
                                        ))}
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8, borderTop: '1px dashed rgba(var(--accent-500-rgb), 0.15)' }}>
                                            <span style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--fg-primary)' }}>Total</span>
                                            <span style={{ fontSize: 'clamp(1.2rem, 5vw, 1.6rem)', fontWeight: 800, background: 'linear-gradient(135deg, var(--fg-primary), var(--accent-400))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
                                                {formatCurrency(advancedResult.total)}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </motion.div>
                        )}

                        {/* ═══ BASIC RESULT ═══ */}
                        {scanMode === 'basic' && parsed && (<>
                            {/* ── Main Data Card ── */}
                            <motion.div
                                initial={{ opacity: 0, y: 16 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.1 }}
                            >
                                <div style={{
                                    ...glass,
                                    borderRadius: 'var(--radius-2xl)',
                                    overflow: 'hidden',
                                    boxShadow: parsed.confidence >= 0.7
                                        ? '0 0 30px rgba(var(--accent-500-rgb), 0.1), var(--shadow-card)'
                                        : 'var(--shadow-card)',
                                    position: 'relative',
                                }}>
                                    {/* Top glow edge */}
                                    <div style={{
                                        position: 'absolute', top: 0, left: '10%', right: '10%', height: 1,
                                        background: 'linear-gradient(90deg, transparent, rgba(var(--accent-500-rgb), 0.3), transparent)',
                                        pointerEvents: 'none',
                                    }} />

                                    {/* Amount hero */}
                                    <div style={{
                                        padding: 'var(--space-5) var(--space-4) var(--space-3)',
                                        background: 'linear-gradient(135deg, rgba(var(--accent-500-rgb), 0.06), transparent)',
                                        textAlign: 'center',
                                    }}>
                                        <p style={{
                                            fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)',
                                            fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em',
                                            marginBottom: 4,
                                        }}>Amount Detected</p>
                                        <p style={{
                                            fontSize: 'clamp(1.8rem, 8vw, 2.5rem)',
                                            fontWeight: 800,
                                            background: parsed.amount
                                                ? 'linear-gradient(135deg, var(--fg-primary), var(--accent-400))'
                                                : 'linear-gradient(135deg, var(--color-error), #f87171)',
                                            WebkitBackgroundClip: 'text',
                                            WebkitTextFillColor: 'transparent',
                                            backgroundClip: 'text',
                                        }}>
                                            {parsed.amount ? formatCurrency(parsed.amount) : '—'}
                                        </p>
                                    </div>

                                    {/* Detail rows */}
                                    <div style={{ padding: 'var(--space-3) var(--space-4) var(--space-4)' }}>
                                        <div style={{
                                            display: 'grid', gridTemplateColumns: '1fr 1fr',
                                            gap: 'var(--space-3)',
                                        }}>
                                            {/* Merchant */}
                                            <div style={{
                                                background: 'rgba(var(--accent-500-rgb), 0.04)',
                                                borderRadius: 'var(--radius-lg)',
                                                padding: 'var(--space-3)',
                                            }}>
                                                <p style={{
                                                    fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)',
                                                    fontWeight: 600, marginBottom: 4,
                                                }}>Merchant</p>
                                                <p style={{
                                                    fontSize: 'var(--text-sm)', fontWeight: 600,
                                                    color: 'var(--fg-primary)',
                                                    wordBreak: 'break-word',
                                                }}>
                                                    {parsed.merchant || '—'}
                                                </p>
                                            </div>

                                            {/* Payment Method */}
                                            <div style={{
                                                background: 'rgba(var(--accent-500-rgb), 0.04)',
                                                borderRadius: 'var(--radius-lg)',
                                                padding: 'var(--space-3)',
                                            }}>
                                                <p style={{
                                                    fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)',
                                                    fontWeight: 600, marginBottom: 4,
                                                }}>Method</p>
                                                {parsed.method ? (
                                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                                        <PaymentIcon method={parsed.method} size={18} />
                                                        <span style={{ fontWeight: 600, fontSize: 'var(--text-sm)', color: 'var(--fg-primary)' }}>
                                                            {PAYMENT_ICONS[parsed.method]?.label || parsed.method}
                                                        </span>
                                                    </span>
                                                ) : (
                                                    <span style={{ color: 'var(--fg-muted)', fontSize: 'var(--text-sm)' }}>—</span>
                                                )}
                                            </div>

                                            {/* UPI Ref */}
                                            {parsed.upiRef && (
                                                <div style={{
                                                    gridColumn: '1 / -1',
                                                    background: 'rgba(var(--accent-500-rgb), 0.04)',
                                                    borderRadius: 'var(--radius-lg)',
                                                    padding: 'var(--space-3)',
                                                }}>
                                                    <p style={{
                                                        fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)',
                                                        fontWeight: 600, marginBottom: 4,
                                                    }}>UPI Reference</p>
                                                    <p style={{
                                                        fontSize: 'var(--text-sm)', fontWeight: 600,
                                                        fontFamily: 'var(--font-mono)',
                                                        color: 'var(--fg-primary)',
                                                        letterSpacing: '0.05em',
                                                    }}>
                                                        {parsed.upiRef}
                                                    </p>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </motion.div>

                            {/* ── Raw Text (collapsible) ── */}
                            <details style={{ cursor: 'pointer' }}>
                                <summary style={{
                                    fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)',
                                    display: 'flex', alignItems: 'center', gap: 6,
                                    padding: 'var(--space-2) 0',
                                    fontWeight: 600,
                                }}>
                                    <FileText size={12} />
                                    View raw OCR text
                                </summary>
                                <div style={{
                                    ...glass,
                                    borderRadius: 'var(--radius-lg)',
                                    padding: 'var(--space-3)',
                                    marginTop: 4,
                                }}>
                                    <pre style={{
                                        fontSize: 'var(--text-xs)',
                                        color: 'var(--fg-secondary)',
                                        whiteSpace: 'pre-wrap',
                                        wordBreak: 'break-word',
                                        fontFamily: 'var(--font-mono)',
                                        maxHeight: 150, overflow: 'auto',
                                        margin: 0,
                                    }}>
                                        {parsed.rawText}
                                    </pre>
                                </div>
                            </details>
                        </>)}

                        {/* ── Actions ── */}
                        <motion.div
                            initial={{ opacity: 0, y: 12 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.2 }}
                            style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}
                        >
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
                                {/* Split by Items - Special Feature */}
                                {scanMode === 'advanced' && advancedResult && advancedResult.items.length > 0 && (
                                    <motion.button
                                        whileHover={{ scale: 1.02 }}
                                        whileTap={{ scale: 0.97 }}
                                        onClick={() => setShowSplitByItems(true)}
                                        style={{
                                            gridColumn: '1 / -1',
                                            ...glass,
                                            borderRadius: 'var(--radius-xl)',
                                            padding: 'var(--space-4)',
                                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                            cursor: 'pointer',
                                            border: '1px solid rgba(16, 185, 129, 0.3)',
                                            background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.08), rgba(16, 185, 129, 0.02))',
                                            textAlign: 'left'
                                        }}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                            <div style={{
                                                width: 40, height: 40, borderRadius: 'var(--radius-lg)',
                                                background: 'linear-gradient(135deg, #10b981, #059669)',
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                boxShadow: '0 4px 12px rgba(16, 185, 129, 0.25)',
                                            }}>
                                                <Users size={20} style={{ color: 'white' }} />
                                            </div>
                                            <div>
                                                <span style={{ display: 'block', fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--fg-primary)' }}>
                                                    Split by Items
                                                </span>
                                                <span style={{ display: 'block', fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)' }}>
                                                    Assign {advancedResult.items.length} items to friends
                                                </span>
                                            </div>
                                        </div>
                                        <div style={{
                                            width: 28, height: 28, borderRadius: '50%',
                                            background: 'rgba(16, 185, 129, 0.1)',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        }}>
                                            <Users size={14} style={{ color: '#10b981' }} />
                                        </div>
                                    </motion.button>
                                )}

                                {/* Add as Expense - Primary Action */}
                                <motion.button
                                    whileHover={{ scale: 1.02 }}
                                    whileTap={{ scale: 0.97 }}
                                    onClick={handleSaveToExpense}
                                    disabled={saving}
                                    style={{
                                        gridColumn: '1 / -1',
                                        padding: 'var(--space-4)',
                                        borderRadius: 'var(--radius-xl)',
                                        background: 'linear-gradient(135deg, var(--accent-500), var(--accent-600))',
                                        color: 'white',
                                        border: 'none',
                                        cursor: 'pointer',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                                        boxShadow: '0 8px 20px rgba(var(--accent-500-rgb), 0.3)',
                                        opacity: saving ? 0.7 : 1,
                                        position: 'relative', overflow: 'hidden'
                                    }}
                                >
                                    <div style={{
                                        position: 'absolute', inset: 0,
                                        background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent)',
                                        transform: 'skewX(-20deg) translateX(-150%)',
                                        animation: 'shimmer 3s infinite'
                                    }} />
                                    {saving ? (
                                        <Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} />
                                    ) : (
                                        <Check size={20} />
                                    )}
                                    <span style={{ fontSize: 'var(--text-base)', fontWeight: 700 }}>
                                        {saving ? 'Saving...' : 'Add as Expense'}
                                    </span>
                                </motion.button>
                            </div>

                            <div style={{ display: 'flex', gap: 'var(--space-3)', marginTop: 4 }}>
                                <motion.button
                                    whileHover={{ scale: 1.02 }}
                                    whileTap={{ scale: 0.95 }}
                                    onClick={reset}
                                    style={{
                                        flex: 1,
                                        padding: 'var(--space-3)',
                                        borderRadius: 'var(--radius-lg)',
                                        ...glass,
                                        background: 'var(--bg-surface)',
                                        color: 'var(--fg-secondary)',
                                        fontWeight: 600,
                                        fontSize: 'var(--text-sm)',
                                        border: '1px solid var(--border-secondary)',
                                        cursor: 'pointer',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                                    }}
                                >
                                    <RotateCcw size={16} />
                                    Scan Another
                                </motion.button>
                                <motion.button
                                    whileHover={{ scale: 1.05 }}
                                    whileTap={{ scale: 0.9 }}
                                    onClick={reset} // Should this be router.back() or close? Context implies reset/close.
                                    style={{
                                        width: 48, height: 48,
                                        borderRadius: 'var(--radius-lg)',
                                        background: 'rgba(239, 68, 68, 0.08)',
                                        border: '1px solid rgba(239, 68, 68, 0.15)',
                                        color: 'var(--color-error)',
                                        cursor: 'pointer',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    }}
                                >
                                    <X size={20} />
                                </motion.button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}

                {/* ═══════════════════════════════════════════ */}
                {/* ═══ ERROR STATE — Friendly Retry ═══ */}
                {/* ═══════════════════════════════════════════ */}
                {scanState === 'error' && (
                    <motion.div key="error" {...scaleIn}>
                        <div style={{
                            ...glass,
                            borderRadius: 'var(--radius-2xl)',
                            padding: 'var(--space-6) var(--space-4)',
                            textAlign: 'center',
                            display: 'flex', flexDirection: 'column',
                            alignItems: 'center', gap: 'var(--space-3)',
                        }}>
                            <div style={{
                                width: 64, height: 64, borderRadius: 'var(--radius-xl)',
                                background: 'rgba(239, 68, 68, 0.1)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                border: '1px solid rgba(239, 68, 68, 0.15)',
                            }}>
                                <X size={28} style={{ color: 'var(--color-error)' }} />
                            </div>
                            <div>
                                <p style={{
                                    fontWeight: 700, fontSize: 'var(--text-base)',
                                    color: 'var(--fg-primary)', marginBottom: 4,
                                }}>
                                    Scan Failed
                                </p>
                                <p style={{
                                    fontSize: 'var(--text-sm)', color: 'var(--fg-tertiary)',
                                    maxWidth: 280, lineHeight: 1.5,
                                }}>
                                    {errorMsg}
                                </p>
                            </div>
                            <motion.button
                                whileHover={{ scale: 1.03 }}
                                whileTap={{ scale: 0.95 }}
                                onClick={reset}
                                style={{
                                    padding: 'var(--space-3) var(--space-6)',
                                    borderRadius: 'var(--radius-xl)',
                                    background: 'linear-gradient(135deg, var(--accent-500), var(--accent-600))',
                                    color: 'white',
                                    fontWeight: 700,
                                    fontSize: 'var(--text-sm)',
                                    border: 'none',
                                    cursor: 'pointer',
                                    display: 'flex', alignItems: 'center', gap: 6,
                                    boxShadow: '0 4px 16px rgba(var(--accent-500-rgb), 0.3)',
                                    marginTop: 4,
                                }}
                            >
                                <RotateCcw size={14} />
                                Try Again
                            </motion.button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* ═══ LIVE CAMERA VIEWFINDER — rendered via Portal to escape transform context ═══ */}
            {mounted && createPortal(
                <AnimatePresence>
                    {showCamera && (
                        <motion.div
                            key="camera-overlay"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            style={{
                                position: 'fixed', inset: 0, zIndex: 99999,
                                background: '#000',
                                display: 'flex', flexDirection: 'column',
                                overflow: 'hidden',
                            }}
                        >
                            {/* ── Top bar ── */}
                            <div style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                padding: '16px 20px',
                                paddingTop: 'calc(env(safe-area-inset-top, 16px) + 8px)',
                                flexShrink: 0,
                            }}>
                                <span style={{ color: 'white', fontWeight: 700, fontSize: 15 }}>
                                    📸 Scan Receipt
                                </span>
                                <motion.button
                                    whileTap={{ scale: 0.85 }}
                                    onClick={closeCamera}
                                    style={{
                                        width: 36, height: 36, borderRadius: '50%',
                                        background: 'rgba(255,255,255,0.12)',
                                        border: '1px solid rgba(255,255,255,0.15)',
                                        color: 'white', display: 'flex', alignItems: 'center',
                                        justifyContent: 'center', cursor: 'pointer',
                                    }}
                                >
                                    <X size={18} />
                                </motion.button>
                            </div>

                            {/* ── Video area — takes all available space ── */}
                            <div style={{
                                flex: 1, position: 'relative',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                padding: '0 16px', overflow: 'hidden',
                                minHeight: 0,
                            }}>
                                <video
                                    ref={videoRef}
                                    autoPlay
                                    playsInline
                                    muted
                                    style={{
                                        width: '100%', height: '100%',
                                        borderRadius: 20,
                                        objectFit: 'cover',
                                        display: 'block',
                                        border: '2px solid rgba(var(--accent-500-rgb), 0.25)',
                                    }}
                                />
                                {/* Scan guide — portrait for receipt scanning */}
                                <div style={{
                                    position: 'absolute', top: '50%', left: '50%',
                                    transform: 'translate(-50%, -50%)',
                                    width: '70%', maxWidth: 280,
                                    aspectRatio: '3/4',
                                    border: '2px dashed rgba(var(--accent-500-rgb), 0.45)',
                                    borderRadius: 16,
                                    pointerEvents: 'none',
                                    boxShadow: '0 0 0 4000px rgba(0,0,0,0.3)',
                                }} />
                            </div>

                            {/* ── Bottom controls ── */}
                            <div style={{
                                display: 'flex', flexDirection: 'column', alignItems: 'center',
                                padding: '20px 16px',
                                paddingBottom: 'calc(env(safe-area-inset-bottom, 16px) + 20px)',
                                flexShrink: 0, gap: 8,
                            }}>
                                <motion.button
                                    whileTap={{ scale: 0.85 }}
                                    onClick={captureFrame}
                                    style={{
                                        width: 68, height: 68, borderRadius: '50%',
                                        background: 'linear-gradient(135deg, var(--accent-500), var(--accent-600))',
                                        border: '4px solid rgba(255,255,255,0.3)',
                                        cursor: 'pointer',
                                        boxShadow: '0 4px 24px rgba(var(--accent-500-rgb), 0.5)',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    }}
                                >
                                    <Camera size={26} style={{ color: 'white' }} />
                                </motion.button>
                                <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, margin: 0 }}>
                                    Tap to capture
                                </p>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>,
                document.body
            )}

            {/* Hidden canvas for frame capture */}
            <canvas ref={canvasRef} style={{ display: 'none' }} />

            {/* Split by Items Modal */}
            {advancedResult && (
                <SplitByItems
                    isOpen={showSplitByItems}
                    onClose={() => setShowSplitByItems(false)}
                    items={advancedResult.items}
                    taxes={advancedResult.taxes}
                    subtotal={advancedResult.subtotal}
                    total={advancedResult.total}
                    merchant={advancedResult.merchant}
                    onCreateExpense={(splits, title, total) => {
                        setShowSplitByItems(false);
                        // Navigate to add expense with pre-filled split data
                        const params = new URLSearchParams({
                            title,
                            amount: String(total / 100), // Convert paise to rupees for input field
                            category: advancedResult.category || 'food',
                            splitData: JSON.stringify(splits),
                        });
                        router.push(`/transactions/new?${params.toString()}`);
                    }}
                />
            )}
        </div>
    );
}
