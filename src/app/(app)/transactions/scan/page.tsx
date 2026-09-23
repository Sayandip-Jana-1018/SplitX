'use client';

import { Suspense, useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { createPortal } from 'react-dom';
import { useRouter, useSearchParams } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import {
    Camera,
    Check,
    FileText,
    ImagePlus,
    Images,
    RotateCcw,
    ScanLine,
    ShieldCheck,
    Sparkles,
    Users,
    X,
    Zap,
} from 'lucide-react';
import Button from '@/components/ui/Button';
import { PaymentTag } from '@/components/ui/Icons';
import { IconTile, ListGroup, ListRow, Notice, Progress, Segmented, Tag } from '@/components/ui/kit';
import { useToast } from '@/components/ui/Toast';
import SplitByItems from '@/components/features/SplitByItems';
import { useIsClient } from '@/hooks/useMediaQuery';
import { uploadReceipt } from '@/lib/receiptUpload';
import { parseTransactionText, type ParsedTransaction } from '@/lib/transactionParser';
import { cn, formatCurrency } from '@/lib/utils';
import styles from './scan.module.css';

type ScanState = 'idle' | 'loading' | 'result' | 'error';
type ScanMode = 'basic' | 'advanced';

interface AdvancedResult {
    merchant: string | null;
    date: string | null;
    /** `price` is the row's total, quantity included. */
    items: { name: string; quantity: number; price: number }[];
    subtotal: number;
    taxes: Record<string, number>;
    total: number;
    /** ISO 4217 code of the amounts as printed. */
    currency: string;
    category: string;
    confidence: number;
}

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

/**
 * On-device reading loads its worker, engine and English model from this site
 * (scripts/tesseract-assets.mjs copies them in at build), not from a CDN. The
 * worker starts straight from its file, not through a blob: wrapper.
 */
const TESSERACT_FILES = {
    workerPath: '/tesseract/worker.min.js',
    corePath: '/tesseract/core',
    langPath: '/tesseract/lang',
    workerBlobURL: false,
};

const STEPS = [
    { Icon: Camera, title: 'Snap', text: 'Photo or screenshot' },
    { Icon: Sparkles, title: 'Read', text: 'We pull out the details' },
    { Icon: Check, title: 'Save', text: 'Review, split, done' },
];

const fade = {
    initial: { opacity: 0, y: 14 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -10 },
    transition: { duration: 0.22 },
};

function readAsDataUrl(file: File) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
    });
}

/**
 * The photo the AI scan sends: at most 2,048 pixels on the long side, as a
 * JPEG. The vision model scales anything larger down to that anyway, so a
 * phone's 12-megapixel photo only cost upload time and hit the server's 4 MB
 * limit. Falls back to the original when the browser can't decode it.
 */
async function photoForAiScan(file: File, original: string) {
    try {
        const bitmap = await createImageBitmap(file);
        const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(bitmap.width * scale);
        canvas.height = Math.round(bitmap.height * scale);
        canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        bitmap.close();
        return canvas.toDataURL('image/jpeg', 0.85);
    } catch {
        return original;
    }
}

function errorMessage(data: unknown, fallback: string) {
    const error = (data as { error?: unknown } | null)?.error;
    return typeof error === 'string' && error ? error : fallback;
}

const confidenceTone = (value: number) => (value >= 0.7 ? 'success' : value >= 0.4 ? 'warning' : 'danger');
const confidenceLabel = (value: number) => (value >= 0.7 ? 'High' : value >= 0.4 ? 'Medium' : 'Low');

export default function ScanReceiptPage() {
    return (
        <Suspense>
            <ScanReceipt />
        </Suspense>
    );
}

function ScanReceipt() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const groupId = searchParams.get('groupId');
    const { toast } = useToast();
    const isClient = useIsClient();

    const cameraInputRef = useRef<HTMLInputElement>(null);
    const galleryInputRef = useRef<HTMLInputElement>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const progressTimerRef = useRef<number | undefined>(undefined);
    const fileRef = useRef<File | null>(null);

    const [mode, setMode] = useState<ScanMode>('basic');
    const [state, setState] = useState<ScanState>('idle');
    const [progress, setProgress] = useState(0);
    const [preview, setPreview] = useState<string | null>(null);
    const [parsed, setParsed] = useState<ParsedTransaction | null>(null);
    const [advanced, setAdvanced] = useState<AdvancedResult | null>(null);
    const [errorMsg, setErrorMsg] = useState('');
    const [saving, setSaving] = useState(false);
    const [cameraOpen, setCameraOpen] = useState(false);
    const [splitOpen, setSplitOpen] = useState(false);
    const [dragging, setDragging] = useState(false);

    const stopStream = useCallback(() => {
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
    }, []);

    // Release the camera and timers if the user navigates away mid-scan.
    useEffect(() => () => {
        stopStream();
        window.clearInterval(progressTimerRef.current);
    }, [stopStream]);

    // Attach the live stream once the viewfinder has mounted.
    useEffect(() => {
        const video = videoRef.current;
        if (!cameraOpen || !video || !streamRef.current) return;
        video.srcObject = streamRef.current;
        video.play().catch(() => { /* autoplay blocked — the user can still capture */ });
    }, [cameraOpen]);

    const fail = (message: string) => {
        window.clearInterval(progressTimerRef.current);
        setErrorMsg(message);
        setState('error');
    };

    const runAdvanced = async (base64: string) => {
        setState('loading');
        setProgress(4);
        window.clearInterval(progressTimerRef.current);
        progressTimerRef.current = window.setInterval(() => setProgress((value) => Math.min(value + 3, 92)), 300);
        try {
            const res = await fetch('/api/receipt-scan', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ image: base64 }),
            });
            const payload = await res.json().catch(() => null);
            if (!res.ok || !payload) {
                fail(errorMessage(payload, 'The AI scan didn’t work this time. Try again, or use on-device mode.'));
                return;
            }
            window.clearInterval(progressTimerRef.current);
            setProgress(100);
            setAdvanced({ ...(payload as AdvancedResult), currency: (payload as AdvancedResult).currency || 'INR' });
            setState('result');
        } catch {
            fail('Couldn’t reach the AI service. Check your connection and try again.');
        }
    };

    const runBasic = async (file: File) => {
        setState('loading');
        setProgress(0);
        try {
            const Tesseract = await import('tesseract.js');
            const result = await Tesseract.recognize(file, 'eng', {
                ...TESSERACT_FILES,
                logger: (message: { status: string; progress: number }) => {
                    if (message.status === 'recognizing text') setProgress(Math.round(message.progress * 100));
                },
            });
            const text = result.data.text;
            if (!text.trim()) {
                fail('We couldn’t find any text. Try a sharper photo in better light.');
                return;
            }
            setParsed(parseTransactionText(text));
            setState('result');
        } catch (error) {
            console.error('OCR error:', error);
            fail('On-device reading failed. Try again, or switch to AI scan.');
        }
    };

    const handleFile = async (file: File) => {
        if (!file.type.startsWith('image/')) {
            fail('Pick an image file — a photo or a screenshot.');
            return;
        }
        if (file.size > MAX_IMAGE_BYTES) {
            fail('That image is over 15 MB. Try a smaller one.');
            return;
        }
        fileRef.current = file;
        setParsed(null);
        setAdvanced(null);

        let base64: string;
        try {
            base64 = await readAsDataUrl(file);
        } catch {
            fail('Couldn’t open that image.');
            return;
        }
        setPreview(base64);
        if (mode === 'advanced') await runAdvanced(await photoForAiScan(file, base64));
        else await runBasic(file);
    };

    const onInputChange = (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (file) void handleFile(file);
    };

    const openCamera = async () => {
        if (!navigator.mediaDevices?.getUserMedia) {
            cameraInputRef.current?.click();
            return;
        }
        try {
            streamRef.current = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'environment', width: { ideal: 1080 }, height: { ideal: 1920 } },
            });
            setCameraOpen(true);
        } catch {
            // Permission denied or no camera — fall back to the system picker.
            cameraInputRef.current?.click();
        }
    };

    const closeCamera = () => {
        stopStream();
        setCameraOpen(false);
    };

    const captureFrame = () => {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        if (!video || !canvas || !video.videoWidth) return;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext('2d')?.drawImage(video, 0, 0);
        canvas.toBlob((blob) => {
            if (!blob) return;
            closeCamera();
            void handleFile(new File([blob], 'camera-capture.jpg', { type: 'image/jpeg' }));
        }, 'image/jpeg', 0.92);
    };

    const onDrop = (event: DragEvent) => {
        event.preventDefault();
        setDragging(false);
        const file = event.dataTransfer.files?.[0];
        if (file) void handleFile(file);
    };

    const reset = () => {
        window.clearInterval(progressTimerRef.current);
        setState('idle');
        setProgress(0);
        setParsed(null);
        setAdvanced(null);
        setPreview(null);
        setErrorMsg('');
        fileRef.current = null;
    };

    const retryWithAi = () => {
        if (!preview) return;
        setMode('advanced');
        void runAdvanced(preview);
    };

    const uploadCurrentReceipt = async () => {
        const file = fileRef.current;
        if (!file) return null;
        return uploadReceipt(file);
    };

    const goToComposer = (params: URLSearchParams) => {
        params.set('source', 'scan');
        if (groupId && !params.has('groupId')) params.set('groupId', groupId);
        router.push(`/transactions/new?${params.toString()}`);
    };

    // SplitX keeps every group in rupees. A bill in another currency carries
    // over without its amount, for the person to type what they paid in ₹.
    const billCurrency = mode === 'advanced' ? advanced?.currency ?? 'INR' : parsed?.currency ?? 'INR';
    const inRupees = billCurrency === 'INR';

    const addAsExpense = async () => {
        setSaving(true);
        const receiptUrl = await uploadCurrentReceipt();
        if (!receiptUrl && fileRef.current) {
            toast('The photo couldn’t be saved, but the details carry over', 'info');
        }
        const params = new URLSearchParams();
        if (receiptUrl) params.set('receiptUrl', receiptUrl);
        if (mode === 'advanced' && advanced) {
            if (advanced.total && inRupees) params.set('amount', String(advanced.total / 100));
            if (advanced.merchant) params.set('title', advanced.merchant);
            if (advanced.category) params.set('category', advanced.category);
        } else if (parsed) {
            if (parsed.amount) params.set('amount', String(parsed.amount / 100));
            if (parsed.merchant) params.set('title', parsed.merchant);
            if (parsed.method) params.set('method', parsed.method);
        }
        goToComposer(params);
    };

    const confidence = mode === 'advanced' ? advanced?.confidence ?? 0 : parsed?.confidence ?? 0;
    const hasResult = mode === 'advanced' ? Boolean(advanced) : Boolean(parsed);

    return (
        <div className={styles.page}>
            <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" hidden onChange={onInputChange} />
            <input ref={galleryInputRef} type="file" accept="image/*" hidden onChange={onInputChange} />

            <AnimatePresence mode="wait" initial={false}>
                {/* ── Pick ── */}
                {state === 'idle' && (
                    <motion.div key="idle" className={styles.stack} {...fade}>
                        <Segmented<ScanMode>
                            ariaLabel="Scan mode"
                            value={mode}
                            onChange={setMode}
                            options={[
                                { value: 'basic', label: <span className={styles.modeLabel}><Zap size={14} />On-device</span> },
                                { value: 'advanced', label: <span className={styles.modeLabel}><Sparkles size={14} />AI scan</span> },
                            ]}
                        />

                        <motion.button
                            type="button"
                            className={cn(styles.dropzone, dragging && styles.dropzoneActive)}
                            onClick={openCamera}
                            onDragOver={(event) => {
                                event.preventDefault();
                                setDragging(true);
                            }}
                            onDragLeave={() => setDragging(false)}
                            onDrop={onDrop}
                            whileTap={{ scale: 0.985 }}
                        >
                            <span className={styles.corners} aria-hidden="true" />
                            <motion.span
                                className={styles.dropIcon}
                                animate={{ y: [0, -6, 0] }}
                                transition={{ repeat: Infinity, duration: 2.6, ease: 'easeInOut' }}
                            >
                                <ScanLine size={30} />
                            </motion.span>
                            <span className={styles.dropTitle}>Scan a bill or payment screenshot</span>
                            <span className={styles.dropText}>
                                {mode === 'basic'
                                    ? 'Reads the amount, merchant and UPI reference — right on your phone.'
                                    : 'Reads every item and tax, so you can split line by line.'}
                            </span>
                            <span className={styles.dropHint}>GPay · PhonePe · Paytm · bank SMS · restaurant bills</span>
                        </motion.button>

                        <div className={styles.twoUp}>
                            <Button size="lg" leftIcon={<Camera size={18} />} onClick={openCamera}>Camera</Button>
                            <Button size="lg" variant="secondary" leftIcon={<ImagePlus size={18} />} onClick={() => galleryInputRef.current?.click()}>
                                Gallery
                            </Button>
                        </div>

                        <ol className={styles.steps}>
                            {STEPS.map((step, index) => (
                                <li key={step.title} className={styles.step}>
                                    <span className={styles.stepIcon}><step.Icon size={16} /></span>
                                    <span className={styles.stepText}>
                                        <strong>{index + 1}. {step.title}</strong>
                                        {step.text}
                                    </span>
                                </li>
                            ))}
                        </ol>

                        <ListGroup>
                            <ListRow
                                href="/transactions/receipts"
                                leading={<IconTile tone="neutral"><Images size={18} /></IconTile>}
                                title="Saved receipts"
                                subtitle="Every bill you’ve scanned, in one gallery"
                                chevron
                            />
                        </ListGroup>

                        <p className={styles.privacy}>
                            <ShieldCheck size={13} />
                            {mode === 'basic'
                                ? 'On-device mode never uploads your image.'
                                : 'AI scan sends the image securely for processing.'}
                        </p>
                    </motion.div>
                )}

                {/* ── Reading ── */}
                {state === 'loading' && (
                    <motion.div key="loading" className={styles.stack} {...fade}>
                        <div className={styles.scanCard}>
                            {preview && (
                                <div className={styles.previewFrame}>
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={preview} alt="Receipt being scanned" className={styles.previewImage} />
                                    <motion.span
                                        className={styles.scanBeam}
                                        animate={{ top: ['6%', '92%', '6%'] }}
                                        transition={{ repeat: Infinity, duration: 2.4, ease: 'easeInOut' }}
                                    />
                                    <span className={styles.frameCorners} aria-hidden="true" />
                                </div>
                            )}
                            <p className={styles.scanTitle}>Reading your receipt…</p>
                            <p className={styles.scanText}>
                                {mode === 'advanced' ? 'AI is itemising products, taxes and totals' : 'Extracting text on your device'}
                            </p>
                            <div className={styles.progressWrap}><Progress value={progress} /></div>
                            <span className={styles.scanPct}>{progress}%</span>
                        </div>
                    </motion.div>
                )}

                {/* ── Review ── */}
                {state === 'result' && hasResult && (
                    <motion.div key="result" className={styles.stack} {...fade}>
                        <div className={styles.resultHead}>
                            {preview ? (
                                /* eslint-disable-next-line @next/next/no-img-element */
                                <img src={preview} alt="" className={styles.thumb} />
                            ) : (
                                <IconTile size={48}><ScanLine size={20} /></IconTile>
                            )}
                            <div className={styles.resultHeadText}>
                                <span className={styles.resultEyebrow}>{mode === 'advanced' ? 'AI scan' : 'On-device scan'}</span>
                                <span className={styles.resultTitle}>Here’s what we found</span>
                            </div>
                            <Tag tone={confidenceTone(confidence)}>
                                {confidenceLabel(confidence)} · {Math.round(confidence * 100)}%
                            </Tag>
                        </div>

                        {!inRupees && (
                            <Notice tone="warning" title={`This bill ${mode === 'advanced' ? 'is' : 'looks to be'} in ${billCurrency}`}>
                                SplitX keeps every group in rupees, so its amount doesn’t carry over. Type what you paid
                                in ₹ on the next screen.{mode === 'advanced' && ' Splitting by item works for bills in rupees.'}
                            </Notice>
                        )}

                        {mode === 'advanced' && advanced && (
                            <div className={styles.receipt}>
                                <div className={styles.receiptTop}>
                                    <span className={styles.receiptMerchant}>{advanced.merchant || 'Receipt'}</span>
                                    {advanced.date && <span className={styles.receiptDate}>{advanced.date}</span>}
                                </div>
                                {advanced.items.length > 0 && (
                                    <ul className={styles.items}>
                                        {advanced.items.map((item, index) => (
                                            <li key={`${item.name}-${index}`} className={styles.item}>
                                                <span className={styles.itemName}>
                                                    {item.name}
                                                    {item.quantity > 1 && <span className={styles.itemQty}>×{item.quantity}</span>}
                                                </span>
                                                <span className={styles.itemPrice}>{formatCurrency(item.price, advanced.currency)}</span>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                                <div className={styles.totals}>
                                    {advanced.subtotal > 0 && (
                                        <div className={styles.totalRow}><span>Subtotal</span><span>{formatCurrency(advanced.subtotal, advanced.currency)}</span></div>
                                    )}
                                    {Object.entries(advanced.taxes).map(([name, amount]) => (
                                        <div key={name} className={styles.totalRow}><span>{name}</span><span>{formatCurrency(amount, advanced.currency)}</span></div>
                                    ))}
                                    <div className={cn(styles.totalRow, styles.grandTotal)}>
                                        <span>Total</span>
                                        <span>{formatCurrency(advanced.total, advanced.currency)}</span>
                                    </div>
                                </div>
                            </div>
                        )}

                        {mode === 'basic' && parsed && (
                            <>
                                <div className={styles.amountCard}>
                                    <span className={styles.amountLabel}>Amount</span>
                                    <span className={cn(styles.amountValue, !parsed.amount && styles.amountMissing)}>
                                        {parsed.amount ? formatCurrency(parsed.amount) : 'Not found'}
                                    </span>
                                    {!parsed.amount && <span className={styles.amountHint}>You can type it on the next screen.</span>}
                                </div>
                                <ListGroup>
                                    <ListRow title="Merchant" trailing={<span className={styles.fieldValue}>{parsed.merchant || '—'}</span>} />
                                    <ListRow
                                        title="Paid with"
                                        trailing={parsed.method ? <PaymentTag method={parsed.method} /> : <span className={styles.fieldValue}>—</span>}
                                    />
                                    {parsed.upiRef && (
                                        <ListRow
                                            title="UPI reference"
                                            trailing={<span className={cn(styles.fieldValue, styles.mono)}>{parsed.upiRef}</span>}
                                        />
                                    )}
                                </ListGroup>
                                <details className={styles.raw}>
                                    <summary><FileText size={13} /> Show raw text</summary>
                                    <pre>{parsed.rawText}</pre>
                                </details>
                            </>
                        )}

                        <div className={styles.actions}>
                            {mode === 'advanced' && advanced && advanced.items.length > 0 && inRupees && (
                                <ListGroup>
                                    <ListRow
                                        onClick={() => setSplitOpen(true)}
                                        leading={<IconTile tone="success"><Users size={18} /></IconTile>}
                                        title="Split by items"
                                        subtitle={`Assign ${advanced.items.length} items to people`}
                                        chevron
                                    />
                                </ListGroup>
                            )}
                            <Button fullWidth size="lg" loading={saving} leftIcon={<Check size={18} />} onClick={addAsExpense}>
                                Add as expense
                            </Button>
                            <Button fullWidth variant="ghost" leftIcon={<RotateCcw size={16} />} onClick={reset} disabled={saving}>
                                Scan another
                            </Button>
                        </div>
                    </motion.div>
                )}

                {/* ── Error ── */}
                {state === 'error' && (
                    <motion.div key="error" className={styles.stack} {...fade}>
                        <div className={styles.errorCard}>
                            <span className={styles.errorIcon}><X size={26} /></span>
                            <p className={styles.errorTitle}>Couldn’t read that one</p>
                            <p className={styles.errorText}>{errorMsg}</p>
                            <div className={styles.twoUp}>
                                {mode === 'basic' && preview ? (
                                    <Button variant="secondary" leftIcon={<Sparkles size={16} />} onClick={retryWithAi}>Try AI scan</Button>
                                ) : (
                                    <Button
                                        variant="secondary"
                                        leftIcon={<ImagePlus size={16} />}
                                        onClick={() => {
                                            reset();
                                            galleryInputRef.current?.click();
                                        }}
                                    >
                                        Pick another
                                    </Button>
                                )}
                                <Button leftIcon={<RotateCcw size={16} />} onClick={reset}>Start over</Button>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* ── Live viewfinder (portal escapes page transforms) ── */}
            {isClient && createPortal(
                <AnimatePresence>
                    {cameraOpen && (
                        <motion.div
                            key="camera"
                            className={styles.camera}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            role="dialog"
                            aria-modal="true"
                            aria-label="Camera"
                        >
                            <div className={styles.cameraBar}>
                                <span className={styles.cameraTitle}>Fit the receipt inside the frame</span>
                                <button type="button" className={styles.cameraButton} onClick={closeCamera} aria-label="Close camera">
                                    <X size={19} />
                                </button>
                            </div>
                            <div className={styles.cameraStage}>
                                <video ref={videoRef} autoPlay playsInline muted className={styles.video} />
                                <span className={styles.guide} aria-hidden="true" />
                            </div>
                            <div className={styles.cameraControls}>
                                <button
                                    type="button"
                                    className={styles.cameraButton}
                                    onClick={() => {
                                        closeCamera();
                                        galleryInputRef.current?.click();
                                    }}
                                    aria-label="Choose from gallery"
                                >
                                    <ImagePlus size={20} />
                                </button>
                                <motion.button
                                    type="button"
                                    whileTap={{ scale: 0.9 }}
                                    className={styles.shutter}
                                    onClick={captureFrame}
                                    aria-label="Capture photo"
                                >
                                    <span className={styles.shutterInner} />
                                </motion.button>
                                <span className={styles.cameraSpacer} aria-hidden="true" />
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>,
                document.body
            )}

            <canvas ref={canvasRef} hidden />

            {advanced && (
                <SplitByItems
                    isOpen={splitOpen}
                    onClose={() => setSplitOpen(false)}
                    items={advanced.items}
                    taxes={advanced.taxes}
                    total={advanced.total}
                    merchant={advanced.merchant}
                    groupId={groupId}
                    onCreateExpense={async (splits, title, total, splitGroupId) => {
                        setSplitOpen(false);
                        setSaving(true);
                        const receiptUrl = await uploadCurrentReceipt();
                        const params = new URLSearchParams({
                            title,
                            amount: String(total / 100),
                            category: advanced.category || 'food',
                            splitData: JSON.stringify(splits),
                            groupId: splitGroupId,
                        });
                        if (receiptUrl) params.set('receiptUrl', receiptUrl);
                        goToComposer(params);
                    }}
                />
            )}
        </div>
    );
}
