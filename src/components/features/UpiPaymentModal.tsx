'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Smartphone, QrCode, CheckCircle2, Copy, Check, Loader2, CreditCard } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { formatCurrency } from '@/lib/utils';

interface UpiPaymentModalProps {
    isOpen: boolean;
    onClose: () => void;
    amount: number;
    payeeName: string;
    settlementId?: string;
    payeeUpiId?: string;
    onPaymentComplete?: () => void;
}

type Step = 'choose' | 'paying' | 'utr' | 'done';

export default function UpiPaymentModal({
    isOpen,
    onClose,
    amount,
    payeeName,
    settlementId,
    payeeUpiId: directUpiId,
    onPaymentComplete,
}: UpiPaymentModalProps) {
    const [step, setStep] = useState<Step>('choose');
    const [upiUrl, setUpiUrl] = useState('');
    const [qrData, setQrData] = useState('');
    const [payeeUpiId, setPayeeUpiId] = useState('');
    const [manualUpiId, setManualUpiId] = useState('');
    const [loading, setLoading] = useState(false);
    const [utrNumber, setUtrNumber] = useState('');
    const [confirmLoading, setConfirmLoading] = useState(false);
    const [error, setError] = useState('');
    const [copied, setCopied] = useState(false);
    const [showQr, setShowQr] = useState(false);
    const isMobile = typeof navigator !== 'undefined' && /Android|iPhone|iPad/i.test(navigator.userAgent);

    useEffect(() => {
        if (!isOpen) {
            setStep('choose');
            setUpiUrl('');
            setQrData('');
            setUtrNumber('');
            setError('');
            setShowQr(false);
            setPayeeUpiId('');
            setManualUpiId('');
        }
    }, [isOpen]);

    const generateLocalLink = (upiId: string) => {
        const amountInRupees = (amount / 100).toFixed(2);
        const params = new URLSearchParams({
            pa: upiId, pn: payeeName || 'AutoSplit User',
            am: amountInRupees, cu: 'INR', tn: 'AutoSplit settlement',
        });
        return `upi://pay?${params.toString()}`;
    };

    const initiatePayment = async (overrideUpiId?: string) => {
        setLoading(true);
        setError('');
        try {
            let generatedUpiUrl: string;
            let generatedQrData: string;
            let resolvedUpiId: string;
            const upiIdToUse = overrideUpiId || directUpiId;

            if (settlementId) {
                const res = await fetch(`/api/settlements/${settlementId}/pay`, { method: 'POST' });
                const data = await res.json();
                if (!res.ok) { setError(data.message || data.error || 'Failed'); setLoading(false); return; }
                generatedUpiUrl = data.upiUrl; generatedQrData = data.qrData; resolvedUpiId = data.payeeUpiId || '';
            } else if (upiIdToUse) {
                generatedUpiUrl = generateLocalLink(upiIdToUse);
                generatedQrData = generatedUpiUrl;
                resolvedUpiId = upiIdToUse;
            } else {
                setError('Enter UPI ID to continue'); setLoading(false); return;
            }
            setUpiUrl(generatedUpiUrl); setQrData(generatedQrData); setPayeeUpiId(resolvedUpiId);
            setStep('paying');
            if (isMobile && generatedUpiUrl) { window.location.href = generatedUpiUrl; } else { setShowQr(true); }
        } catch { setError('Network error'); } finally { setLoading(false); }
    };

    const confirmPayment = async () => {
        setConfirmLoading(true); setError('');
        try {
            if (settlementId) {
                const res = await fetch(`/api/settlements/${settlementId}/confirm`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'paid', utrNumber: utrNumber.trim() || undefined }),
                });
                const data = await res.json();
                if (!res.ok) { setError(data.error || 'Failed'); setConfirmLoading(false); return; }
            }
            setStep('done');
            setTimeout(() => { onPaymentComplete?.(); }, 2000);
        } catch { setError('Network error'); } finally { setConfirmLoading(false); }
    };

    const copyUpiId = () => {
        if (payeeUpiId) {
            navigator.clipboard.writeText(payeeUpiId);
            setCopied(true); setTimeout(() => setCopied(false), 2000);
        }
    };

    if (!isOpen) return null;
    const hasUpiId = !!directUpiId;

    /* ─── Shared inline styles ─── */
    const frostedPill: React.CSSProperties = {
        background: 'rgba(255,255,255,0.18)',
        backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
        border: '1px solid rgba(255,255,255,0.22)',
        borderRadius: 14, padding: '12px 16px',
        color: '#fff',
    };

    const inputStyle: React.CSSProperties = {
        width: '100%', background: 'rgba(255,255,255,0.92)',
        border: '1px solid rgba(255,255,255,0.5)', borderRadius: 10,
        padding: '11px 14px', fontSize: 14, color: '#333',
        outline: 'none', boxSizing: 'border-box', textAlign: 'center',
    };

    const primaryBtn = (disabled: boolean): React.CSSProperties => ({
        width: '100%', padding: '14px', border: 'none', borderRadius: 14,
        fontSize: 15, fontWeight: 700,
        background: disabled ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.95)',
        color: disabled ? 'rgba(255,255,255,0.6)' : 'var(--accent-600)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
        boxShadow: disabled ? 'none' : '0 4px 20px rgba(0,0,0,0.12)',
        transition: 'all 0.2s ease',
    });

    return (
        <AnimatePresence>
            {/* Backdrop */}
            <motion.div
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                onClick={onClose}
                style={{
                    position: 'fixed', inset: 0,
                    background: 'transparent',
                    backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
                    zIndex: 9999,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    padding: 16,
                }}
            >
                {/* Modal — full gradient card */}
                <motion.div
                    initial={{ scale: 0.9, opacity: 0, y: 30 }}
                    animate={{ scale: 1, opacity: 1, y: 0 }}
                    exit={{ scale: 0.9, opacity: 0, y: 30 }}
                    transition={{ type: 'spring', damping: 22, stiffness: 280 }}
                    onClick={(e) => e.stopPropagation()}
                    style={{
                        position: 'relative',
                        background: 'linear-gradient(160deg, var(--accent-400), var(--accent-500) 40%, var(--accent-600))',
                        borderRadius: 24,
                        width: '100%', maxWidth: 360,
                        overflow: 'hidden',
                        boxShadow: '0 24px 80px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.2)',
                        textAlign: 'center',
                    }}
                >
                    {/* Close button */}
                    <button onClick={onClose} style={{
                        position: 'absolute', top: 14, right: 14, zIndex: 2,
                        background: 'rgba(255,255,255,0.2)',
                        border: 'none', borderRadius: '50%',
                        width: 30, height: 30,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        cursor: 'pointer', color: '#fff',
                    }}><X size={15} /></button>

                    {/* ── Header section ── */}
                    <div style={{ padding: '28px 24px 0', position: 'relative' }}>
                        <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.7)' }}>
                            {step === 'done' ? 'Payment Completed' : 'Pay via UPI'}
                        </div>
                        <div style={{ fontSize: 36, fontWeight: 900, color: '#fff', marginTop: 6, letterSpacing: '-0.03em' }}>
                            {formatCurrency(amount)}
                        </div>
                        <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.75)', marginTop: 4, marginBottom: 24 }}>
                            to <strong style={{ color: '#fff' }}>{payeeName}</strong>
                        </div>
                    </div>

                    {/* ── Content ── */}
                    <div style={{ padding: '0 24px 28px' }}>
                        <AnimatePresence mode="wait">
                            {/* ═══ Step: Choose ═══ */}
                            {step === 'choose' && (
                                <motion.div key="choose" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}
                                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>

                                    {error && (
                                        <div style={{
                                            ...frostedPill,
                                            background: 'rgba(239,68,68,0.2)', border: '1px solid rgba(239,68,68,0.3)',
                                            fontSize: 13, padding: '8px 14px', width: '100%',
                                        }}>{error}</div>
                                    )}

                                    {/* Manual UPI input when payee has no ID */}
                                    {!hasUpiId && (
                                        <div style={{ width: '100%' }}>
                                            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.65)', marginBottom: 8 }}>
                                                {payeeName} hasn&apos;t added their UPI ID yet
                                            </div>
                                            <input
                                                type="text" value={manualUpiId}
                                                onChange={(e) => setManualUpiId(e.target.value)}
                                                placeholder="Enter their UPI ID"
                                                style={inputStyle}
                                            />
                                        </div>
                                    )}

                                    <button
                                        onClick={() => initiatePayment(manualUpiId.trim() || undefined)}
                                        disabled={loading || (!hasUpiId && !manualUpiId.trim())}
                                        style={primaryBtn(loading || (!hasUpiId && !manualUpiId.trim()))}
                                    >
                                        {loading
                                            ? <><Loader2 size={17} className="spin" /> Generating...</>
                                            : isMobile
                                                ? <><Smartphone size={17} /> Open UPI App</>
                                                : <><QrCode size={17} /> Show QR Code</>
                                        }
                                    </button>

                                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>
                                        {isMobile ? 'Opens GPay, PhonePe, or default UPI app' : 'Scan the QR code with any UPI app'}
                                    </div>
                                </motion.div>
                            )}

                            {/* ═══ Step: Paying ═══ */}
                            {step === 'paying' && (
                                <motion.div key="paying" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}
                                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>

                                    {/* QR Code */}
                                    {showQr && qrData && (
                                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                            <div style={{
                                                background: '#fff', padding: 14, borderRadius: 16,
                                                boxShadow: '0 8px 30px rgba(0,0,0,0.15)',
                                            }}>
                                                <QRCodeSVG value={qrData} size={170} level="M" />
                                            </div>
                                            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', marginTop: 8, display: 'flex', alignItems: 'center', gap: 5 }}>
                                                <Smartphone size={11} /> Scan with any UPI app
                                            </div>
                                        </div>
                                    )}

                                    {/* UPI ID pill */}
                                    {payeeUpiId && (
                                        <div style={{
                                            ...frostedPill, width: '100%',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                                            fontSize: 13,
                                        }}>
                                            <span style={{ opacity: 0.7 }}>UPI:</span>
                                            <strong style={{ fontFamily: 'monospace', letterSpacing: '0.02em' }}>{payeeUpiId}</strong>
                                            <button onClick={copyUpiId} style={{
                                                background: 'none', border: 'none', cursor: 'pointer',
                                                color: 'rgba(255,255,255,0.7)', padding: 2, display: 'flex',
                                            }}>
                                                {copied ? <Check size={13} /> : <Copy size={13} />}
                                            </button>
                                        </div>
                                    )}

                                    {/* UTR input */}
                                    <div style={{ ...frostedPill, width: '100%', padding: '10px 14px' }}>
                                        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', marginBottom: 6 }}>
                                            Transaction ID (optional)
                                        </div>
                                        <input type="text" value={utrNumber}
                                            onChange={(e) => setUtrNumber(e.target.value)}
                                            placeholder="e.g. 412345678901" maxLength={20}
                                            style={{ ...inputStyle, fontFamily: 'monospace' }}
                                        />
                                    </div>

                                    {error && <div style={{ color: '#fecaca', fontSize: 12 }}>{error}</div>}

                                    <button onClick={() => setStep('utr')} style={primaryBtn(false)}>
                                        <CheckCircle2 size={17} /> I&apos;ve Paid
                                    </button>

                                    {!showQr && (
                                        <button onClick={() => setShowQr(true)} style={{
                                            width: '100%', padding: '10px', background: 'rgba(255,255,255,0.12)',
                                            color: '#fff', border: '1px solid rgba(255,255,255,0.2)',
                                            borderRadius: 10, fontSize: 13, cursor: 'pointer',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                                        }}>
                                            <QrCode size={13} /> Show QR Code
                                        </button>
                                    )}
                                </motion.div>
                            )}

                            {/* ═══ Step: UTR Confirm ═══ */}
                            {step === 'utr' && (
                                <motion.div key="utr" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}
                                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>

                                    <div style={{
                                        width: 56, height: 56, borderRadius: '50%',
                                        background: 'rgba(255,255,255,0.15)',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    }}>
                                        <CreditCard size={24} style={{ color: '#fff' }} />
                                    </div>
                                    <div>
                                        <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>Confirm Payment</div>
                                        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', marginTop: 4, maxWidth: 260 }}>
                                            {utrNumber
                                                ? `UTR: ${utrNumber} will be shared for verification`
                                                : `${payeeName} will manually confirm receipt`}
                                        </div>
                                    </div>

                                    {error && <div style={{ color: '#fecaca', fontSize: 12 }}>{error}</div>}

                                    <button onClick={confirmPayment} disabled={confirmLoading}
                                        style={{ ...primaryBtn(confirmLoading), opacity: confirmLoading ? 0.7 : 1 }}>
                                        {confirmLoading ? <><Loader2 size={17} className="spin" /> Confirming...</> : <><CheckCircle2 size={17} /> Confirm</>}
                                    </button>

                                    <button onClick={() => setStep('paying')} style={{
                                        background: 'none', border: 'none', color: 'rgba(255,255,255,0.6)',
                                        fontSize: 13, cursor: 'pointer', padding: '6px 0',
                                    }}>← Go back</button>
                                </motion.div>
                            )}

                            {/* ═══ Step: Done ═══ */}
                            {step === 'done' && (
                                <motion.div key="done" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
                                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '12px 0' }}>
                                    <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }}
                                        transition={{ type: 'spring', damping: 15, stiffness: 200, delay: 0.1 }}
                                        style={{
                                            width: 64, height: 64, borderRadius: '50%',
                                            background: 'rgba(255,255,255,0.2)',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        }}>
                                        <CheckCircle2 size={32} color="#fff" />
                                    </motion.div>
                                    <div style={{ fontSize: 20, fontWeight: 800, color: '#fff' }}>Payment Completed!</div>
                                    <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.65)' }}>
                                        {payeeName} has been notified
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                </motion.div>
            </motion.div>
        </AnimatePresence>
    );
}
