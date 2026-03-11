'use client';

import { motion } from 'framer-motion';
import { Mic, MicOff, AlertCircle, Check, RotateCcw } from 'lucide-react';
import { MemberAvatar } from './MemberAvatar';
import type { VoiceParseResult, MemberInfo } from './types';

// ── Helpers ──

function findMemberInfo(name: string, members?: MemberInfo[]): MemberInfo | null {
    if (!members) return null;
    const lower = name.toLowerCase();
    return members.find(m => {
        const mLower = m.name.toLowerCase();
        return mLower === lower
            || mLower.startsWith(lower)
            || lower.startsWith(mLower.split(' ')[0])
            || mLower.split(' ')[0] === lower;
    }) || null;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LISTENING PANEL
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface ListeningPanelProps {
    finalText: string;
    interimText: string;
    onDone: () => void;
}

export function ListeningPanel({ finalText, interimText, onDone }: ListeningPanelProps) {
    return (
        <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            style={{
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', gap: 28,
                padding: '0 24px', marginTop: 'min(20vh, 120px)',
                maxWidth: 400, width: '100%',
            }}
        >
            {/* Pulsing mic with concentric rings */}
            <div style={{ position: 'relative', width: 140, height: 140 }}>
                {[0, 1, 2].map(i => (
                    <motion.div
                        key={i}
                        animate={{
                            scale: [1, 1.6 + i * 0.3, 1],
                            opacity: [0.25, 0, 0.25],
                        }}
                        transition={{
                            duration: 2.2,
                            repeat: Infinity,
                            delay: i * 0.45,
                            ease: 'easeInOut',
                        }}
                        style={{
                            position: 'absolute', inset: 0,
                            borderRadius: '50%',
                            border: '2px solid rgba(139, 92, 246, 0.35)',
                        }}
                    />
                ))}
                <motion.div
                    animate={{
                        boxShadow: [
                            '0 0 30px rgba(139, 92, 246, 0.15)',
                            '0 0 60px rgba(139, 92, 246, 0.3)',
                            '0 0 30px rgba(139, 92, 246, 0.15)',
                        ],
                    }}
                    transition={{ duration: 2, repeat: Infinity }}
                    style={{
                        position: 'absolute', inset: 15,
                        borderRadius: '50%',
                        background: 'linear-gradient(135deg, #8b5cf6, #6d28d9)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                >
                    <Mic size={36} color="#fff" strokeWidth={2} />
                </motion.div>
            </div>

            {/* Status label */}
            <motion.div style={{ textAlign: 'center' }}>
                <motion.p
                    animate={{ opacity: [0.4, 1, 0.4] }}
                    transition={{ duration: 2.5, repeat: Infinity }}
                    style={{
                        color: '#a78bfa', fontSize: 13,
                        fontWeight: 700, letterSpacing: '0.15em',
                        textTransform: 'uppercase',
                        marginBottom: 6,
                    }}
                >
                    Listening
                </motion.p>
                <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12, fontWeight: 400 }}>
                    Speak naturally — I&apos;ll stop when you pause
                </p>
            </motion.div>

            {/* Waveform */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 3, height: 36 }}>
                {Array.from({ length: 16 }).map((_, i) => (
                    <motion.div
                        key={i}
                        animate={{ height: [6, 20 + Math.sin(i * 0.8) * 14, 6] }}
                        transition={{
                            duration: 0.7 + (i % 3) * 0.15,
                            repeat: Infinity,
                            delay: i * 0.06,
                            ease: 'easeInOut',
                        }}
                        style={{
                            width: 3, borderRadius: 2,
                            background: 'linear-gradient(180deg, #a78bfa, #7c3aed)',
                            opacity: 0.6 + Math.sin(i * 0.5) * 0.3,
                        }}
                    />
                ))}
            </div>

            {/* Live transcript */}
            <div style={{
                minHeight: 50, maxHeight: 160, width: '100%',
                textAlign: 'center', padding: '0 8px',
                overflowY: 'auto', WebkitOverflowScrolling: 'touch',
            }}>
                {finalText && (
                    <motion.p
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        style={{
                            color: '#fff', fontSize: 20,
                            fontWeight: 500, lineHeight: 1.5,
                            marginBottom: 6,
                        }}
                    >
                        {finalText}
                    </motion.p>
                )}
                {interimText && (
                    <motion.p
                        key={interimText}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 0.45 }}
                        style={{
                            color: '#d4d4d8', fontSize: 17,
                            fontStyle: 'italic', lineHeight: 1.4,
                        }}
                    >
                        {interimText}
                    </motion.p>
                )}
                {!finalText && !interimText && (
                    <p style={{ color: 'rgba(255,255,255,0.2)', fontSize: 15, fontStyle: 'italic' }}>
                        Say something like &quot;Split 500 for pizza between Sneh and Ankit&quot;
                    </p>
                )}
            </div>

            {/* Done button */}
            <motion.button
                onClick={onDone}
                whileTap={{ scale: 0.95 }}
                whileHover={{ scale: 1.02 }}
                style={{
                    padding: '14px 36px', borderRadius: 50,
                    background: 'rgba(139, 92, 246, 0.15)',
                    border: '1px solid rgba(139, 92, 246, 0.3)',
                    color: '#e0d4fd', fontSize: 15, fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 10,
                    transition: 'all 0.2s ease',
                }}
            >
                <MicOff size={16} />
                Add Transaction
            </motion.button>

            {/* Hint */}
            <p style={{
                color: 'rgba(255,255,255,0.2)', fontSize: 11,
                textAlign: 'center', maxWidth: 300,
                lineHeight: 1.6, marginTop: 4,
            }}>
                💡 &quot;Split 300 among Sneh and Ankit&quot; or &quot;423 custom, 234 to Sneh, rest to Ankit&quot;
            </p>
        </motion.div>
    );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PROCESSING PANEL
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface ProcessingPanelProps {
    transcript: string;
}

export function ProcessingPanel({ transcript }: ProcessingPanelProps) {
    return (
        <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.35 }}
            style={{
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', gap: 28,
                padding: '0 24px', marginTop: 'min(28vh, 180px)',
            }}
        >
            <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 1.2, repeat: Infinity, ease: 'linear' }}
                style={{
                    width: 56, height: 56, borderRadius: 28,
                    border: '3px solid rgba(139, 92, 246, 0.15)',
                    borderTopColor: '#8b5cf6',
                }}
            />
            <div style={{ textAlign: 'center' }}>
                <p style={{
                    color: '#e4e4e7', fontSize: 17,
                    fontWeight: 600, marginBottom: 8,
                }}>
                    Understanding your expense...
                </p>
                <p style={{
                    color: 'rgba(255,255,255,0.35)', fontSize: 13,
                    maxWidth: 280, lineHeight: 1.5,
                }}>
                    &quot;{(transcript || '').slice(0, 80)}{(transcript || '').length > 80 ? '...' : ''}&quot;
                </p>
            </div>
        </motion.div>
    );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RESULT PANEL
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface ResultPanelProps {
    result: VoiceParseResult;
    members?: MemberInfo[];
    onRetry: () => void;
    onAccept: () => void;
}

export function ResultPanel({ result, members, onRetry, onAccept }: ResultPanelProps) {
    return (
        <motion.div
            initial={{ scale: 0.92, opacity: 0, y: 30 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
            style={{
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', gap: 0,
                padding: '0 20px', marginTop: 'min(10vh, 60px)',
                maxWidth: 380, width: '100%',
            }}
        >
            {/* Card */}
            <div style={{
                width: '100%',
                background: 'linear-gradient(180deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.03) 100%)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 24,
                padding: '28px 22px 22px',
                boxShadow: '0 20px 60px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.05)',
            }}>
                {/* Success icon */}
                <motion.div
                    initial={{ scale: 0, rotate: -90 }}
                    animate={{ scale: 1, rotate: 0 }}
                    transition={{ type: 'spring', damping: 12, stiffness: 200, delay: 0.1 }}
                    style={{
                        width: 52, height: 52, borderRadius: 26,
                        background: 'linear-gradient(135deg, #22c55e, #15803d)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        boxShadow: '0 0 30px rgba(34, 197, 94, 0.25)',
                        margin: '0 auto 18px',
                    }}
                >
                    <Check size={26} color="#fff" strokeWidth={3} />
                </motion.div>

                {/* Amount */}
                <motion.div
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                    style={{ textAlign: 'center', marginBottom: 18 }}
                >
                    <p style={{
                        color: 'rgba(255,255,255,0.4)', fontSize: 11, fontWeight: 700,
                        textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6,
                    }}>Amount</p>
                    <p style={{
                        fontSize: 36, fontWeight: 800, letterSpacing: '-0.02em',
                        background: 'linear-gradient(135deg, #a78bfa, #7c3aed)',
                        WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
                        backgroundClip: 'text',
                    }}>
                        ₹{result.amount.toLocaleString('en-IN')}
                    </p>
                </motion.div>

                {/* Title + Category */}
                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3 }}
                    style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        gap: 8, marginBottom: 14, flexWrap: 'wrap',
                    }}
                >
                    {result.title && (
                        <span style={{
                            padding: '6px 16px', borderRadius: 12,
                            background: 'rgba(255,255,255,0.06)',
                            border: '1px solid rgba(255,255,255,0.08)',
                            color: '#f4f4f5', fontSize: 14, fontWeight: 500,
                        }}>{result.title}</span>
                    )}
                    {result.category && (
                        <span style={{
                            padding: '6px 14px', borderRadius: 12,
                            background: 'rgba(255,255,255,0.04)',
                            border: '1px solid rgba(255,255,255,0.06)',
                            color: 'rgba(255,255,255,0.55)', fontSize: 12, fontWeight: 600,
                        }}>{result.category}</span>
                    )}
                </motion.div>

                {/* Split type badge */}
                <motion.div
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 0.35 }}
                    style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}
                >
                    <span style={{
                        padding: '5px 16px', borderRadius: 20,
                        background: result.splitType === 'equal'
                            ? 'rgba(139, 92, 246, 0.12)' : 'rgba(249, 115, 22, 0.12)',
                        border: `1px solid ${result.splitType === 'equal'
                            ? 'rgba(139, 92, 246, 0.25)' : 'rgba(249, 115, 22, 0.25)'}`,
                        color: result.splitType === 'equal' ? '#a78bfa' : '#fb923c',
                        fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                        letterSpacing: '0.08em',
                    }}>
                        {result.splitType === 'equal' ? '÷ Equal Split' : '✏️ Custom Split'}
                    </span>
                </motion.div>

                {/* Payer */}
                {result.payer && (
                    <motion.div
                        initial={{ opacity: 0, y: 5 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.38 }}
                        style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            gap: 8, marginBottom: 16,
                        }}
                    >
                        <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12, fontWeight: 500 }}>Paid by</span>
                        <div style={{
                            display: 'flex', alignItems: 'center', gap: 6,
                            padding: '4px 12px 4px 4px', borderRadius: 20,
                            background: 'rgba(255,255,255,0.06)',
                            border: '1px solid rgba(255,255,255,0.08)',
                        }}>
                            <MemberAvatar
                                name={result.payer}
                                image={findMemberInfo(result.payer, members)?.image}
                                size={20}
                            />
                            <span style={{ color: '#f4f4f5', fontSize: 13, fontWeight: 600 }}>
                                {result.payer}
                            </span>
                        </div>
                    </motion.div>
                )}

                {/* Divider */}
                <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', margin: '0 -4px 14px' }} />

                {/* Members */}
                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.4 }}
                    style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
                >
                    <p style={{
                        color: 'rgba(255,255,255,0.3)', fontSize: 10,
                        fontWeight: 700, textTransform: 'uppercase',
                        letterSpacing: '0.12em', textAlign: 'center', marginBottom: 4,
                    }}>Members ({result.members.length})</p>

                    {result.members.map((m, i) => {
                        const memberInfo = findMemberInfo(m.name, members);
                        return (
                            <motion.div
                                key={m.name}
                                initial={{ opacity: 0, x: -16 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: 0.45 + i * 0.08, ease: [0.16, 1, 0.3, 1] }}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: 12,
                                    padding: '12px 14px', borderRadius: 16,
                                    background: 'rgba(255,255,255,0.04)',
                                    border: '1px solid rgba(255,255,255,0.06)',
                                }}
                            >
                                <MemberAvatar name={m.name} image={memberInfo?.image} size={38} />
                                <span style={{ flex: 1, color: '#f4f4f5', fontSize: 15, fontWeight: 600 }}>
                                    {m.name}
                                </span>
                                {m.amount && m.amount > 0 && (
                                    <span style={{
                                        color: '#a78bfa', fontSize: 15, fontWeight: 700,
                                        fontFeatureSettings: "'tnum'",
                                    }}>
                                        ₹{m.amount.toLocaleString('en-IN')}
                                    </span>
                                )}
                                {m.confidence < 0.6 && (
                                    <span style={{ fontSize: 10, color: '#eab308', fontWeight: 600, flexShrink: 0 }}>
                                        ⚠ Verify
                                    </span>
                                )}
                            </motion.div>
                        );
                    })}
                </motion.div>

                {/* Warnings */}
                {result.warnings && result.warnings.length > 0 && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.65 }}
                        style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}
                    >
                        {result.warnings.map((w, i) => (
                            <div key={i} style={{
                                display: 'flex', alignItems: 'center', gap: 8,
                                padding: '8px 12px', borderRadius: 10,
                                background: 'rgba(234, 179, 8, 0.08)',
                                border: '1px solid rgba(234, 179, 8, 0.15)',
                            }}>
                                <AlertCircle size={13} style={{ color: '#eab308', flexShrink: 0 }} />
                                <p style={{ color: '#eab308', fontSize: 11, fontWeight: 500, lineHeight: 1.4 }}>{w}</p>
                            </div>
                        ))}
                    </motion.div>
                )}

                {/* Low confidence warning */}
                {result.confidence < 0.8 && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.7 }}
                        style={{
                            display: 'flex', alignItems: 'center', gap: 8,
                            padding: '8px 14px', borderRadius: 12,
                            background: 'rgba(234, 179, 8, 0.06)',
                            border: '1px solid rgba(234, 179, 8, 0.12)',
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

            {/* Action buttons */}
            <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.6 }}
                style={{ display: 'flex', gap: 12, width: '100%', marginTop: 20, padding: '0 4px' }}
            >
                <motion.button
                    onClick={onRetry}
                    whileTap={{ scale: 0.95 }}
                    style={{
                        flex: 1, padding: '15px 20px', borderRadius: 50,
                        background: 'rgba(255,255,255,0.06)',
                        border: '1px solid rgba(255,255,255,0.1)',
                        color: '#d4d4d8', fontSize: 14, fontWeight: 600,
                        cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                    }}
                >
                    <RotateCcw size={14} /> Retry
                </motion.button>
                <motion.button
                    onClick={onAccept}
                    whileTap={{ scale: 0.95 }}
                    style={{
                        flex: 2, padding: '15px 20px', borderRadius: 50,
                        background: 'linear-gradient(135deg, #8b5cf6, #6d28d9)',
                        border: 'none',
                        color: '#fff', fontSize: 15, fontWeight: 700,
                        cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                        boxShadow: '0 4px 24px rgba(139, 92, 246, 0.35)',
                    }}
                >
                    <Check size={16} /> Use This
                </motion.button>
            </motion.div>

            {/* Raw transcript */}
            <p style={{
                color: 'rgba(255,255,255,0.2)', fontSize: 11,
                textAlign: 'center', fontStyle: 'italic',
                maxWidth: 300, marginTop: 16, lineHeight: 1.5,
            }}>
                &quot;{result.rawTranscript.slice(0, 100)}{result.rawTranscript.length > 100 ? '...' : ''}&quot;
            </p>
        </motion.div>
    );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ERROR PANEL
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface ErrorPanelProps {
    message: string;
    onRetry: () => void;
    onClose: () => void;
}

export function ErrorPanel({ message, onRetry, onClose }: ErrorPanelProps) {
    return (
        <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.35 }}
            style={{
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', gap: 24,
                padding: '0 32px', marginTop: 'min(25vh, 160px)',
                maxWidth: 380,
            }}
        >
            <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', damping: 12 }}
                style={{
                    width: 60, height: 60, borderRadius: 30,
                    background: 'rgba(239, 68, 68, 0.1)',
                    border: '2px solid rgba(239, 68, 68, 0.2)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
            >
                <AlertCircle size={30} color="#ef4444" />
            </motion.div>

            <p style={{
                color: '#f4f4f5', fontSize: 16,
                fontWeight: 600, textAlign: 'center', lineHeight: 1.5,
            }}>
                {message || 'Something went wrong'}
            </p>

            <div style={{ display: 'flex', gap: 12 }}>
                <motion.button
                    onClick={onRetry}
                    whileTap={{ scale: 0.95 }}
                    style={{
                        padding: '13px 30px', borderRadius: 50,
                        background: 'linear-gradient(135deg, #8b5cf6, #6d28d9)',
                        border: 'none',
                        color: '#fff', fontSize: 14, fontWeight: 600,
                        cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: 6,
                        boxShadow: '0 4px 24px rgba(139, 92, 246, 0.25)',
                    }}
                >
                    <RotateCcw size={14} /> Try Again
                </motion.button>
                <motion.button
                    onClick={onClose}
                    whileTap={{ scale: 0.95 }}
                    style={{
                        padding: '13px 30px', borderRadius: 50,
                        background: 'rgba(255,255,255,0.06)',
                        border: '1px solid rgba(255,255,255,0.1)',
                        color: '#d4d4d8', fontSize: 14, fontWeight: 600,
                        cursor: 'pointer',
                    }}
                >
                    Cancel
                </motion.button>
            </div>
        </motion.div>
    );
}
