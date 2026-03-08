'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mic, MicOff, X, Loader2, AlertCircle, Check, RotateCcw } from 'lucide-react';
import Image from 'next/image';

/**
 * VoiceInput — Production-grade voice-powered transaction entry.
 * 
 * Flow:
 * 1. User taps mic → full-screen theme-aware overlay
 * 2. Web Speech API captures voice with live captions
 * 3. On stop → transcript sent to /api/ai/parse-voice
 * 4. Parsed result returned via onResult callback
 * 5. Form auto-fills (user reviews & submits manually)
 */

interface VoiceMember {
    name: string;
    amount?: number;
    confidence: number;
}

export interface VoiceParseResult {
    amount: number;
    title: string;
    category?: string;
    splitType: 'equal' | 'custom';
    members: VoiceMember[];
    payer?: string;
    warnings?: string[];
    confidence: number;
    rawTranscript: string;
}

interface MemberInfo {
    name: string;
    image?: string | null;
}

interface VoiceInputProps {
    memberNames: string[];
    members?: MemberInfo[];
    groupName: string;
    onResult: (result: VoiceParseResult) => void;
}

type VoiceState = 'idle' | 'listening' | 'processing' | 'result' | 'error';

// Web Speech API types (not in default TS lib)
interface SpeechRecognitionResult {
    readonly isFinal: boolean;
    readonly length: number;
    [index: number]: { transcript: string; confidence: number };
}
interface SpeechRecognitionResultList {
    readonly length: number;
    [index: number]: SpeechRecognitionResult;
}
interface SpeechRecognitionEvent extends Event {
    readonly results: SpeechRecognitionResultList;
}
interface SpeechRecognitionErrorEvent extends Event {
    readonly error: string;
}
interface SpeechRecognitionInstance extends EventTarget {
    continuous: boolean;
    interimResults: boolean;
    lang: string;
    maxAlternatives: number;
    onstart: ((this: SpeechRecognitionInstance, ev: Event) => void) | null;
    onresult: ((this: SpeechRecognitionInstance, ev: SpeechRecognitionEvent) => void) | null;
    onerror: ((this: SpeechRecognitionInstance, ev: SpeechRecognitionErrorEvent) => void) | null;
    onend: ((this: SpeechRecognitionInstance, ev: Event) => void) | null;
    start(): void;
    stop(): void;
    abort(): void;
}


// Check for SpeechRecognition support
function getSpeechRecognition(): (new () => SpeechRecognitionInstance) | null {
    if (typeof window === 'undefined') return null;
    const w = window as unknown as { SpeechRecognition: new () => SpeechRecognitionInstance; webkitSpeechRecognition: new () => SpeechRecognitionInstance };
    return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

/** Small avatar component for member display */
function MemberAvatar({ name, image, size = 36 }: { name: string; image?: string | null; size?: number }) {
    const [imgErr, setImgErr] = useState(false);
    const initial = name.charAt(0).toUpperCase();
    const hue = name.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;

    if (image && !imgErr) {
        return (
            <Image
                src={image}
                alt={name}
                width={size}
                height={size}
                onError={() => setImgErr(true)}
                style={{
                    width: size, height: size, borderRadius: size / 2,
                    objectFit: 'cover',
                    border: '2px solid var(--border-glass)',
                    flexShrink: 0,
                }}
            />
        );
    }

    return (
        <div style={{
            width: size, height: size, borderRadius: size / 2,
            background: `hsl(${hue}, 60%, 50%)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontSize: size * 0.4, fontWeight: 700,
            flexShrink: 0,
            border: '2px solid var(--border-glass)',
        }}>
            {initial}
        </div>
    );
}

export default function VoiceInput({ memberNames, members, groupName, onResult }: VoiceInputProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [state, setState] = useState<VoiceState>('idle');
    const [interimText, setInterimText] = useState('');
    const [finalText, setFinalText] = useState('');
    const [parsedResult, setParsedResult] = useState<VoiceParseResult | null>(null);
    const [errorMsg, setErrorMsg] = useState('');

    const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
    const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Listen for external trigger (from mic button in page)
    useEffect(() => {
        const handler = () => setIsOpen(true);
        window.addEventListener('openVoiceInput', handler);
        return () => window.removeEventListener('openVoiceInput', handler);
    }, []);

    // Start recognition when overlay opens
    useEffect(() => {
        if (isOpen && state === 'idle') {
            startListening();
        }
        return () => {
            stopListening();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen]);

    const startListening = useCallback(() => {
        const SR = getSpeechRecognition();
        if (!SR) {
            setState('error');
            setErrorMsg('Voice input is not supported in this browser. Please use Chrome or Edge.');
            return;
        }

        try {
            const recognition = new SR();
            recognition.continuous = true;
            recognition.interimResults = true;
            recognition.lang = 'en-IN';
            recognition.maxAlternatives = 1;

            recognition.onstart = () => {
                setState('listening');
                setInterimText('');
                setFinalText('');
                if (navigator.vibrate) navigator.vibrate(50);
            };

            recognition.onresult = (event: SpeechRecognitionEvent) => {
                let interim = '';
                let final = '';

                for (let i = 0; i < event.results.length; i++) {
                    const result = event.results[i];
                    if (result.isFinal) {
                        final += result[0].transcript + ' ';
                    } else {
                        interim += result[0].transcript;
                    }
                }

                setFinalText(prev => {
                    const combined = prev ? prev.trim() + ' ' + final.trim() : final.trim();
                    return combined.trim();
                });
                setInterimText(interim);

                // Reset silence timer
                if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
                silenceTimerRef.current = setTimeout(() => {
                    // Auto-stop after 3s of silence
                    stopListening();
                }, 3000);
            };

            recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
                console.error('Speech error:', event.error);
                if (event.error === 'not-allowed') {
                    setState('error');
                    setErrorMsg('Microphone access denied. Please allow microphone access in your browser settings.');
                } else if (event.error === 'no-speech') {
                    // Keep listening, don't error out immediately
                } else {
                    setState('error');
                    setErrorMsg(`Voice recognition error: ${event.error}. Please try again.`);
                }
            };

            recognition.onend = () => {
                // If we were still listening (not manually stopped), process
                if (state === 'listening') {
                    processTranscript();
                }
            };

            recognitionRef.current = recognition;
            recognition.start();
        } catch (err) {
            console.error('Failed to start recognition:', err);
            setState('error');
            setErrorMsg('Could not start voice recognition. Please try again.');
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [memberNames, groupName]);

    const stopListening = useCallback(() => {
        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
        if (recognitionRef.current) {
            try {
                recognitionRef.current.stop();
            } catch { /* already stopped */ }
            recognitionRef.current = null;
        }
    }, []);

    const processTranscript = useCallback(async () => {
        const transcript = (finalText + ' ' + interimText).trim();
        if (!transcript) {
            setState('error');
            setErrorMsg('No speech detected. Please try again and speak clearly.');
            return;
        }

        setState('processing');
        setInterimText('');
        if (navigator.vibrate) navigator.vibrate([30, 50, 30]);

        try {
            const res = await fetch('/api/ai/parse-voice', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ transcript, memberNames, groupName }),
            });

            if (!res.ok) {
                throw new Error('Parse request failed');
            }

            const result: VoiceParseResult = await res.json();
            setParsedResult(result);
            setState('result');
            if (navigator.vibrate) navigator.vibrate([50, 100, 50]);
        } catch (err) {
            console.error('Parse error:', err);
            setState('error');
            setErrorMsg('Could not understand the expense. Please try again.');
        }
    }, [finalText, interimText, memberNames, groupName]);

    const handleDone = useCallback(() => {
        stopListening();
        processTranscript();
    }, [stopListening, processTranscript]);

    const handleClose = useCallback(() => {
        stopListening();
        setIsOpen(false);
        setState('idle');
        setInterimText('');
        setFinalText('');
        setParsedResult(null);
        setErrorMsg('');
    }, [stopListening]);

    const handleAccept = useCallback(() => {
        if (parsedResult) {
            onResult(parsedResult);
            if (navigator.vibrate) navigator.vibrate(100);
        }
        handleClose();
    }, [parsedResult, onResult, handleClose]);

    const handleRetry = useCallback(() => {
        setState('idle');
        setInterimText('');
        setFinalText('');
        setParsedResult(null);
        setErrorMsg('');
        startListening();
    }, [startListening]);

    // Helper: find member info by name
    const findMemberInfo = (name: string): MemberInfo | null => {
        if (!members) return null;
        const lower = name.toLowerCase();
        return members.find(m => {
            const mLower = m.name.toLowerCase();
            return mLower === lower
                || mLower.startsWith(lower)
                || lower.startsWith(mLower.split(' ')[0])
                || mLower.split(' ')[0] === lower;
        }) || null;
    };

    if (!isOpen) return null;

    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25 }}
                style={{
                    position: 'fixed',
                    inset: 0,
                    zIndex: 9999,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'var(--voice-overlay, rgba(var(--bg-primary-rgb, 0, 0, 0), 0.92))',
                    backdropFilter: 'blur(24px) saturate(1.5)',
                    WebkitBackdropFilter: 'blur(24px) saturate(1.5)',
                }}
            >
                {/* Close button */}
                <motion.button
                    onClick={handleClose}
                    whileTap={{ scale: 0.9 }}
                    style={{
                        position: 'absolute', top: 16, right: 16,
                        width: 40, height: 40, borderRadius: 20,
                        background: 'var(--surface-card)',
                        border: '1px solid var(--border-glass)',
                        color: 'var(--fg-tertiary)',
                        cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                    aria-label="Close voice input"
                >
                    <X size={18} />
                </motion.button>

                {/* ── Listening State ── */}
                {state === 'listening' && (
                    <motion.div
                        initial={{ scale: 0.8, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        style={{
                            display: 'flex', flexDirection: 'column',
                            alignItems: 'center', gap: 32,
                            padding: '0 24px',
                            maxWidth: 400, width: '100%',
                        }}
                    >
                        {/* Pulsing mic with rings */}
                        <div style={{ position: 'relative', width: 120, height: 120 }}>
                            {/* Concentric rings */}
                            {[0, 1, 2].map(i => (
                                <motion.div
                                    key={i}
                                    animate={{
                                        scale: [1, 1.5 + i * 0.3, 1],
                                        opacity: [0.3, 0, 0.3],
                                    }}
                                    transition={{
                                        duration: 2,
                                        repeat: Infinity,
                                        delay: i * 0.4,
                                        ease: 'easeInOut',
                                    }}
                                    style={{
                                        position: 'absolute', inset: 0,
                                        borderRadius: '50%',
                                        border: '2px solid rgba(var(--accent-500-rgb, 99, 102, 241), 0.4)',
                                    }}
                                />
                            ))}
                            {/* Main mic button */}
                            <motion.button
                                onClick={handleDone}
                                whileTap={{ scale: 0.95 }}
                                animate={{ boxShadow: ['0 0 20px rgba(var(--accent-500-rgb, 99, 102, 241), 0.3)', '0 0 40px rgba(var(--accent-500-rgb, 99, 102, 241), 0.5)', '0 0 20px rgba(var(--accent-500-rgb, 99, 102, 241), 0.3)'] }}
                                transition={{ duration: 2, repeat: Infinity }}
                                style={{
                                    position: 'absolute', inset: 20,
                                    borderRadius: '50%',
                                    background: 'linear-gradient(135deg, var(--accent-500, #6366f1), var(--accent-600, #4f46e5))',
                                    border: 'none',
                                    color: '#fff',
                                    cursor: 'pointer',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                }}
                                aria-label="Stop recording"
                            >
                                <Mic size={32} />
                            </motion.button>
                        </div>

                        {/* Label */}
                        <motion.p
                            animate={{ opacity: [0.5, 1, 0.5] }}
                            transition={{ duration: 2, repeat: Infinity }}
                            style={{
                                color: 'var(--fg-tertiary)', fontSize: 14,
                                fontWeight: 600, letterSpacing: '0.1em',
                                textTransform: 'uppercase',
                            }}
                        >
                            Listening...
                        </motion.p>

                        {/* Waveform animation */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 3, height: 32 }}>
                            {Array.from({ length: 12 }).map((_, i) => (
                                <motion.div
                                    key={i}
                                    animate={{
                                        height: [8, 24 + Math.random() * 12, 8],
                                    }}
                                    transition={{
                                        duration: 0.6 + Math.random() * 0.4,
                                        repeat: Infinity,
                                        delay: i * 0.08,
                                        ease: 'easeInOut',
                                    }}
                                    style={{
                                        width: 3, borderRadius: 2,
                                        background: `linear-gradient(180deg, var(--accent-400, #818cf8), var(--accent-600, #4f46e5))`,
                                        opacity: 0.7,
                                    }}
                                />
                            ))}
                        </div>

                        {/* Live transcript */}
                        <div style={{
                            minHeight: 60, maxWidth: '100%',
                            textAlign: 'center', padding: '0 16px',
                        }}>
                            {finalText && (
                                <motion.p
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    style={{
                                        color: 'var(--fg-primary)', fontSize: 18,
                                        fontWeight: 500, lineHeight: 1.5,
                                        marginBottom: 4,
                                    }}
                                >
                                    {finalText}
                                </motion.p>
                            )}
                            {interimText && (
                                <motion.p
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 0.5 }}
                                    style={{
                                        color: 'var(--fg-tertiary)', fontSize: 16,
                                        fontStyle: 'italic', lineHeight: 1.4,
                                    }}
                                >
                                    {interimText}
                                </motion.p>
                            )}
                        </div>

                        {/* Done button */}
                        <motion.button
                            onClick={handleDone}
                            whileTap={{ scale: 0.95 }}
                            style={{
                                padding: '12px 32px', borderRadius: 16,
                                background: 'rgba(var(--accent-500-rgb, 99, 102, 241), 0.12)',
                                border: '1px solid rgba(var(--accent-500-rgb, 99, 102, 241), 0.2)',
                                color: 'var(--fg-primary)', fontSize: 15, fontWeight: 600,
                                cursor: 'pointer',
                                display: 'flex', alignItems: 'center', gap: 8,
                            }}
                        >
                            <MicOff size={16} />
                            Add Transaction
                        </motion.button>

                        {/* Hint */}
                        <p style={{
                            color: 'var(--fg-muted)', fontSize: 12,
                            textAlign: 'center', maxWidth: 280,
                            lineHeight: 1.5,
                        }}>
                            💡 Try: &quot;Split 500 among Sneh and Sayandip&quot; or &quot;423 custom, 234 to Sayandip, rest to Ankit&quot;
                        </p>
                    </motion.div>
                )}

                {/* ── Processing State ── */}
                {state === 'processing' && (
                    <motion.div
                        initial={{ scale: 0.9, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        style={{
                            display: 'flex', flexDirection: 'column',
                            alignItems: 'center', gap: 24,
                            padding: '0 24px',
                        }}
                    >
                        <motion.div
                            animate={{ rotate: 360 }}
                            transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
                        >
                            <Loader2 size={48} style={{ color: 'var(--accent-400, #818cf8)' }} />
                        </motion.div>

                        <p style={{
                            color: 'var(--fg-secondary)', fontSize: 16,
                            fontWeight: 600,
                        }}>
                            Understanding your expense...
                        </p>

                        <p style={{
                            color: 'var(--fg-muted)', fontSize: 14,
                            textAlign: 'center', maxWidth: 280,
                        }}>
                            &quot;{(finalText || '').slice(0, 60)}{(finalText || '').length > 60 ? '...' : ''}&quot;
                        </p>
                    </motion.div>
                )}

                {/* ── Result State — Theme-aware card ── */}
                {state === 'result' && parsedResult && (
                    <motion.div
                        initial={{ scale: 0.9, opacity: 0, y: 20 }}
                        animate={{ scale: 1, opacity: 1, y: 0 }}
                        style={{
                            display: 'flex', flexDirection: 'column',
                            alignItems: 'center', gap: 0,
                            padding: '0 20px',
                            maxWidth: 380, width: '100%',
                        }}
                    >
                        {/* Result Card */}
                        <div style={{
                            width: '100%',
                            background: 'var(--bg-elevated)',
                            border: '1px solid var(--border-glass)',
                            borderRadius: 24,
                            padding: '24px 20px 20px',
                            boxShadow: '0 16px 48px rgba(0,0,0,0.12), 0 0 0 1px var(--border-subtle)',
                        }}>
                            {/* Success icon */}
                            <motion.div
                                initial={{ scale: 0 }}
                                animate={{ scale: 1 }}
                                transition={{ type: 'spring', damping: 12, stiffness: 200, delay: 0.1 }}
                                style={{
                                    width: 48, height: 48, borderRadius: 24,
                                    background: 'linear-gradient(135deg, #22c55e, #16a34a)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    boxShadow: '0 0 24px rgba(34, 197, 94, 0.3)',
                                    margin: '0 auto 16px',
                                }}
                            >
                                <Check size={24} color="#fff" />
                            </motion.div>

                            {/* Amount */}
                            <motion.div
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.2 }}
                                style={{ textAlign: 'center', marginBottom: 16 }}
                            >
                                <p style={{
                                    color: 'var(--fg-tertiary)', fontSize: 11, fontWeight: 700,
                                    textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4,
                                }}>
                                    Amount
                                </p>
                                <p style={{
                                    fontSize: 32, fontWeight: 800, letterSpacing: '-0.02em',
                                    background: 'linear-gradient(135deg, var(--accent-400), var(--accent-600))',
                                    WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
                                    backgroundClip: 'text',
                                }}>
                                    ₹{parsedResult.amount.toLocaleString('en-IN')}
                                </p>
                            </motion.div>

                            {/* Title + Category row */}
                            <motion.div
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.3 }}
                                style={{
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    gap: 8, marginBottom: 16, flexWrap: 'wrap',
                                }}
                            >
                                {parsedResult.title && (
                                    <span style={{
                                        padding: '5px 14px', borderRadius: 10,
                                        background: 'var(--surface-sunken)',
                                        border: '1px solid var(--border-subtle)',
                                        color: 'var(--fg-primary)', fontSize: 14, fontWeight: 500,
                                    }}>
                                        {parsedResult.title}
                                    </span>
                                )}
                                {parsedResult.category && (
                                    <span style={{
                                        padding: '5px 12px', borderRadius: 10,
                                        background: 'var(--surface-sunken)',
                                        border: '1px solid var(--border-subtle)',
                                        color: 'var(--fg-secondary)', fontSize: 12, fontWeight: 600,
                                    }}>
                                        {parsedResult.category}
                                    </span>
                                )}
                            </motion.div>

                            {/* Split type badge */}
                            <motion.div
                                initial={{ opacity: 0, scale: 0.8 }}
                                animate={{ opacity: 1, scale: 1 }}
                                transition={{ delay: 0.35 }}
                                style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}
                            >
                                <span style={{
                                    padding: '4px 14px', borderRadius: 20,
                                    background: parsedResult.splitType === 'equal'
                                        ? 'rgba(var(--accent-500-rgb, 99, 102, 241), 0.1)'
                                        : 'rgba(249, 115, 22, 0.1)',
                                    border: `1px solid ${parsedResult.splitType === 'equal'
                                        ? 'rgba(var(--accent-500-rgb, 99, 102, 241), 0.2)'
                                        : 'rgba(249, 115, 22, 0.2)'}`,
                                    color: parsedResult.splitType === 'equal' ? 'var(--accent-400)' : '#fb923c',
                                    fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                                    letterSpacing: '0.08em',
                                }}>
                                    {parsedResult.splitType === 'equal' ? '÷ Equal Split' : '✏️ Custom Split'}
                                </span>
                            </motion.div>

                            {/* Payer info */}
                            {parsedResult.payer && (
                                <motion.div
                                    initial={{ opacity: 0, y: 5 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: 0.38 }}
                                    style={{
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        gap: 8, marginBottom: 16,
                                    }}
                                >
                                    <span style={{ color: 'var(--fg-muted)', fontSize: 12, fontWeight: 500 }}>Paid by</span>
                                    <div style={{
                                        display: 'flex', alignItems: 'center', gap: 6,
                                        padding: '4px 10px 4px 4px', borderRadius: 20,
                                        background: 'var(--surface-sunken)',
                                        border: '1px solid var(--border-subtle)',
                                    }}>
                                        <MemberAvatar
                                            name={parsedResult.payer}
                                            image={findMemberInfo(parsedResult.payer)?.image}
                                            size={20}
                                        />
                                        <span style={{ color: 'var(--fg-primary)', fontSize: 13, fontWeight: 600 }}>
                                            {parsedResult.payer}
                                        </span>
                                    </div>
                                </motion.div>
                            )}

                            {/* Divider */}
                            <div style={{
                                height: 1, background: 'var(--border-subtle)',
                                margin: '0 -4px 14px',
                            }} />

                            {/* Members list */}
                            <motion.div
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.4 }}
                                style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
                            >
                                <p style={{
                                    color: 'var(--fg-muted)', fontSize: 10,
                                    fontWeight: 700, textTransform: 'uppercase',
                                    letterSpacing: '0.1em', textAlign: 'center',
                                    marginBottom: 2,
                                }}>
                                    Members ({parsedResult.members.length})
                                </p>
                                {parsedResult.members.map((m, i) => {
                                    const memberInfo = findMemberInfo(m.name);
                                    return (
                                        <motion.div
                                            key={m.name}
                                            initial={{ opacity: 0, x: -20 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            transition={{ delay: 0.45 + i * 0.08 }}
                                            style={{
                                                display: 'flex', alignItems: 'center',
                                                gap: 12,
                                                padding: '10px 14px', borderRadius: 14,
                                                background: 'var(--surface-sunken)',
                                                border: '1px solid var(--border-subtle)',
                                            }}
                                        >
                                            <MemberAvatar
                                                name={m.name}
                                                image={memberInfo?.image}
                                                size={36}
                                            />
                                            <span style={{
                                                flex: 1,
                                                color: 'var(--fg-primary)', fontSize: 14, fontWeight: 600,
                                            }}>
                                                {m.name}
                                            </span>
                                            {m.amount && m.amount > 0 && (
                                                <span style={{
                                                    color: 'var(--accent-500)', fontSize: 14, fontWeight: 700,
                                                    fontFeatureSettings: "'tnum'",
                                                }}>
                                                    ₹{m.amount.toLocaleString('en-IN')}
                                                </span>
                                            )}
                                            {m.confidence < 0.6 && (
                                                <span style={{
                                                    fontSize: 10, color: '#eab308',
                                                    fontWeight: 600, flexShrink: 0,
                                                }}>
                                                    ⚠ Verify
                                                </span>
                                            )}
                                        </motion.div>
                                    );
                                })}
                            </motion.div>

                            {/* Confidence warning */}
                            {parsedResult.confidence < 0.8 && (
                                <motion.div
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    transition={{ delay: 0.7 }}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: 8,
                                        padding: '8px 14px', borderRadius: 12,
                                        background: 'rgba(234, 179, 8, 0.08)',
                                        border: '1px solid rgba(234, 179, 8, 0.15)',
                                        marginTop: 12,
                                    }}
                                >
                                    <AlertCircle size={14} style={{ color: '#eab308', flexShrink: 0 }} />
                                    <p style={{ color: '#eab308', fontSize: 11, fontWeight: 500, lineHeight: 1.4 }}>
                                        Low confidence — please review before submitting
                                    </p>
                                </motion.div>
                            )}
                        </div>

                        {/* Action buttons — outside the card */}
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ delay: 0.6 }}
                            style={{
                                display: 'flex', gap: 12, width: '100%',
                                marginTop: 16, padding: '0 4px',
                            }}
                        >
                            <motion.button
                                onClick={handleRetry}
                                whileTap={{ scale: 0.95 }}
                                style={{
                                    flex: 1, padding: '14px 20px', borderRadius: 16,
                                    background: 'var(--surface-card)',
                                    border: '1px solid var(--border-glass)',
                                    color: 'var(--fg-secondary)',
                                    fontSize: 14, fontWeight: 600, cursor: 'pointer',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                                }}
                            >
                                <RotateCcw size={14} /> Retry
                            </motion.button>
                            <motion.button
                                onClick={handleAccept}
                                whileTap={{ scale: 0.95 }}
                                style={{
                                    flex: 2, padding: '14px 20px', borderRadius: 16,
                                    background: 'linear-gradient(135deg, var(--accent-500, #6366f1), var(--accent-600, #4f46e5))',
                                    border: 'none',
                                    color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                                    boxShadow: '0 4px 20px rgba(var(--accent-500-rgb, 99, 102, 241), 0.3)',
                                }}
                            >
                                <Check size={16} /> Use This
                            </motion.button>
                        </motion.div>

                        {/* Raw transcript — subtle */}
                        <p style={{
                            color: 'var(--fg-muted)', fontSize: 11,
                            textAlign: 'center', fontStyle: 'italic',
                            maxWidth: 300, marginTop: 12, opacity: 0.6,
                        }}>
                            &quot;{parsedResult.rawTranscript}&quot;
                        </p>
                    </motion.div>
                )}

                {/* ── Error State ── */}
                {state === 'error' && (
                    <motion.div
                        initial={{ scale: 0.9, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        style={{
                            display: 'flex', flexDirection: 'column',
                            alignItems: 'center', gap: 20,
                            padding: '0 32px',
                            maxWidth: 380,
                        }}
                    >
                        <motion.div
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            transition={{ type: 'spring', damping: 12 }}
                            style={{
                                width: 56, height: 56, borderRadius: 28,
                                background: 'rgba(239, 68, 68, 0.1)',
                                border: '2px solid rgba(239, 68, 68, 0.25)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}
                        >
                            <AlertCircle size={28} color="#ef4444" />
                        </motion.div>

                        <p style={{
                            color: 'var(--fg-primary)', fontSize: 16,
                            fontWeight: 600, textAlign: 'center',
                        }}>
                            {errorMsg || 'Something went wrong'}
                        </p>

                        <div style={{ display: 'flex', gap: 12 }}>
                            <motion.button
                                onClick={handleRetry}
                                whileTap={{ scale: 0.95 }}
                                style={{
                                    padding: '12px 28px', borderRadius: 14,
                                    background: 'linear-gradient(135deg, var(--accent-500, #6366f1), var(--accent-600, #4f46e5))',
                                    border: 'none',
                                    color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer',
                                    display: 'flex', alignItems: 'center', gap: 6,
                                }}
                            >
                                <RotateCcw size={14} /> Try Again
                            </motion.button>
                            <motion.button
                                onClick={handleClose}
                                whileTap={{ scale: 0.95 }}
                                style={{
                                    padding: '12px 28px', borderRadius: 14,
                                    background: 'var(--surface-card)',
                                    border: '1px solid var(--border-glass)',
                                    color: 'var(--fg-secondary)',
                                    fontSize: 14, fontWeight: 600, cursor: 'pointer',
                                }}
                            >
                                Cancel
                            </motion.button>
                        </div>
                    </motion.div>
                )}
            </motion.div>
        </AnimatePresence>
    );
}
