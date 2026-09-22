'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, AtSign, Check, CheckCircle2, Copy, QrCode, Send, ShieldCheck, Smartphone } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import Button from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import Modal from '@/components/ui/Modal';
import { Notice } from '@/components/ui/kit';
import { cn, formatCurrency } from '@/lib/utils';
import styles from './upi.module.css';

interface UpiPaymentModalProps {
    isOpen: boolean;
    onClose: () => void;
    /** paise */
    amount: number;
    payeeName: string;
    settlementId?: string;
    payeeUpiId?: string;
    onPaymentComplete?: () => void;
}

type Step = 'choose' | 'paying' | 'confirm' | 'done';

const UPI_PATTERN = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z][a-zA-Z0-9.-]{1,64}$/;

const stepMotion = {
    initial: { opacity: 0, y: 10 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -8 },
    transition: { duration: 0.18 },
};

function isMobileDevice() {
    return typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

export default function UpiPaymentModal(props: UpiPaymentModalProps) {
    return (
        <Modal isOpen={props.isOpen} onClose={props.onClose} title="Pay via UPI" size="small">
            {/* Remounts on every open, so each payment starts fresh. */}
            <UpiFlow {...props} />
        </Modal>
    );
}

function UpiFlow({ amount, payeeName, settlementId, payeeUpiId: knownUpiId, onClose, onPaymentComplete }: UpiPaymentModalProps) {
    const mobile = isMobileDevice();
    const [step, setStep] = useState<Step>('choose');
    const [manualMode, setManualMode] = useState(!settlementId && !knownUpiId);
    const [manualUpiId, setManualUpiId] = useState('');
    const [upiUrl, setUpiUrl] = useState('');
    const [resolvedUpiId, setResolvedUpiId] = useState('');
    const [showQr, setShowQr] = useState(false);
    const [utr, setUtr] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [copied, setCopied] = useState(false);

    // Hand control back to the caller shortly after the approval request goes out.
    useEffect(() => {
        if (step !== 'done') return;
        const timer = window.setTimeout(() => onPaymentComplete?.(), 1800);
        return () => window.clearTimeout(timer);
    }, [step, onPaymentComplete]);

    const manualValue = manualUpiId.trim();
    const manualInvalid = manualMode && manualValue.length > 0 && !UPI_PATTERN.test(manualValue);

    const localLink = (upiId: string) => {
        const query = new URLSearchParams({
            pa: upiId,
            pn: payeeName || 'SplitX user',
            am: (amount / 100).toFixed(2),
            cu: 'INR',
            tn: 'SplitX settlement',
        });
        return `upi://pay?${query.toString()}`;
    };

    const openPayment = (url: string, upiId: string) => {
        setUpiUrl(url);
        setResolvedUpiId(upiId);
        setStep('paying');
        if (mobile) window.location.href = url;
        else setShowQr(true);
    };

    const startPayment = async () => {
        setError('');
        if (manualMode) {
            if (!UPI_PATTERN.test(manualValue)) {
                setError('Enter a valid UPI ID, like name@okaxis.');
                return;
            }
            openPayment(localLink(manualValue), manualValue);
            return;
        }
        if (!settlementId) {
            if (knownUpiId) openPayment(localLink(knownUpiId), knownUpiId);
            return;
        }

        setLoading(true);
        try {
            const res = await fetch(`/api/settlements/${settlementId}/pay`, { method: 'POST' });
            const data = await res.json().catch(() => null);
            if (!res.ok || !data?.upiUrl) {
                // Only a payee without a UPI ID is worked around, by typing theirs in.
                // Any other refusal (balances changed, already paid) stops here:
                // paying by hand would move money the app then can't record.
                if (data?.code === 'no_upi_id') {
                    setError(`${payeeName} hasn’t added a UPI ID yet. Enter it to continue.`);
                    setManualMode(true);
                } else {
                    setError(data?.error || 'This payment can’t be started right now. Refresh and try again.');
                }
                return;
            }
            openPayment(data.upiUrl, data.payeeUpiId || '');
        } catch {
            setError('Network error — please try again.');
        } finally {
            setLoading(false);
        }
    };

    const confirmPaid = async () => {
        setError('');
        if (!settlementId) {
            setStep('done');
            return;
        }
        setLoading(true);
        try {
            const res = await fetch(`/api/settlements/${settlementId}/confirm`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'paid', utrNumber: utr.trim() || undefined }),
            });
            const data = await res.json().catch(() => null);
            if (!res.ok) {
                setError(data?.error || 'We couldn’t send the approval request. Try again.');
                return;
            }
            setStep('done');
        } catch {
            setError('Network error — please try again.');
        } finally {
            setLoading(false);
        }
    };

    const copyUpiId = async () => {
        if (!resolvedUpiId) return;
        try {
            await navigator.clipboard.writeText(resolvedUpiId);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1800);
        } catch { /* clipboard unavailable */ }
    };

    return (
        <div className={styles.flow}>
            <div className={styles.hero}>
                <span className={styles.heroLabel}>{step === 'done' ? 'Waiting for approval' : 'You’re paying'}</span>
                <span className={styles.heroAmount}>{formatCurrency(amount)}</span>
                <span className={styles.heroTo}>to <strong>{payeeName}</strong></span>
            </div>

            <AnimatePresence mode="wait" initial={false}>
                {step === 'choose' && (
                    <motion.div key="choose" className={styles.step} {...stepMotion}>
                        {error && <Notice tone={manualMode ? 'warning' : 'danger'}>{error}</Notice>}
                        {manualMode && (
                            <Input
                                label={`${payeeName.split(' ')[0]}’s UPI ID`}
                                placeholder="name@okaxis"
                                value={manualUpiId}
                                onChange={(event) => setManualUpiId(event.target.value)}
                                leftIcon={<AtSign size={16} />}
                                autoCapitalize="none"
                                autoCorrect="off"
                                spellCheck={false}
                                error={manualInvalid ? 'That doesn’t look like a UPI ID' : undefined}
                                hint={!manualInvalid ? 'Ask them — it’s shown in any UPI app' : undefined}
                            />
                        )}
                        <Button
                            fullWidth
                            size="lg"
                            loading={loading}
                            disabled={manualMode && !manualValue}
                            leftIcon={mobile ? <Smartphone size={18} /> : <QrCode size={18} />}
                            onClick={startPayment}
                        >
                            {mobile ? 'Open UPI app' : 'Show QR code'}
                        </Button>
                        <p className={styles.hint}>
                            <ShieldCheck size={13} />
                            Works with GPay, PhonePe, Paytm and any UPI app
                        </p>
                    </motion.div>
                )}

                {step === 'paying' && (
                    <motion.div key="paying" className={styles.step} {...stepMotion}>
                        {showQr && upiUrl && (
                            <div className={styles.qr}>
                                <div className={styles.qrCard}>
                                    <QRCodeSVG value={upiUrl} size={176} level="M" bgColor="#ffffff" fgColor="#0d0f14" />
                                </div>
                                <span className={styles.hint}><Smartphone size={12} />Scan with any UPI app</span>
                            </div>
                        )}
                        {resolvedUpiId && (
                            <div className={styles.upiRow}>
                                <span className={styles.upiLabel}>UPI</span>
                                <span className={styles.upiId}>{resolvedUpiId}</span>
                                <button type="button" className={styles.copyButton} onClick={copyUpiId} aria-label="Copy UPI ID">
                                    {copied ? <Check size={15} /> : <Copy size={15} />}
                                </button>
                            </div>
                        )}
                        <Input
                            label="UPI transaction ID (optional)"
                            placeholder="e.g. 412345678901"
                            value={utr}
                            onChange={(event) => setUtr(event.target.value)}
                            maxLength={22}
                            autoCapitalize="characters"
                            autoCorrect="off"
                            spellCheck={false}
                            className={styles.monoInput}
                            hint="Helps them match your payment faster"
                        />
                        <Button fullWidth size="lg" leftIcon={<CheckCircle2 size={18} />} onClick={() => setStep('confirm')}>
                            I’ve paid
                        </Button>
                        {!showQr ? (
                            <Button fullWidth variant="ghost" leftIcon={<QrCode size={16} />} onClick={() => setShowQr(true)}>
                                Show QR code instead
                            </Button>
                        ) : mobile && upiUrl ? (
                            <Button fullWidth variant="ghost" leftIcon={<Smartphone size={16} />} onClick={() => { window.location.href = upiUrl; }}>
                                Open UPI app again
                            </Button>
                        ) : null}
                    </motion.div>
                )}

                {step === 'confirm' && (
                    <motion.div key="confirm" className={styles.step} {...stepMotion}>
                        <div className={styles.center}>
                            <span className={styles.stateIcon}><Send size={24} /></span>
                            <p className={styles.stateTitle}>Confirm you’ve paid</p>
                            <p className={styles.stateText}>
                                {utr.trim()
                                    ? `We’ll share UTR ${utr.trim()} so ${payeeName} can match it quickly.`
                                    : `${payeeName} will get a request to approve once the money arrives.`}
                            </p>
                        </div>
                        {error && <Notice tone="danger">{error}</Notice>}
                        <Button fullWidth size="lg" loading={loading} leftIcon={<CheckCircle2 size={18} />} onClick={confirmPaid}>
                            Send for approval
                        </Button>
                        <Button fullWidth variant="ghost" leftIcon={<ArrowLeft size={16} />} onClick={() => setStep('paying')} disabled={loading}>
                            Back
                        </Button>
                    </motion.div>
                )}

                {step === 'done' && (
                    <motion.div key="done" className={styles.step} {...stepMotion}>
                        <div className={styles.center}>
                            <motion.span
                                className={cn(styles.stateIcon, styles.stateSuccess)}
                                initial={{ scale: 0.4, rotate: -12 }}
                                animate={{ scale: 1, rotate: 0 }}
                                transition={{ type: 'spring', stiffness: 420, damping: 15 }}
                            >
                                <Check size={30} strokeWidth={3} />
                            </motion.span>
                            <p className={styles.stateTitle}>Sent for approval</p>
                            <p className={styles.stateText}>
                                {payeeName} has been notified. Your balance updates as soon as they approve.
                            </p>
                        </div>
                        <Button fullWidth variant="secondary" onClick={onPaymentComplete ?? onClose}>Done</Button>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
