'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';

// Modular voice feature imports
import type { VoiceState, VoiceParseResult, VoiceInputProps } from './voice/types';
import { useSpeechRecognition } from './voice/useSpeechRecognition';
import { ListeningPanel, ProcessingPanel, ResultPanel, ErrorPanel } from './voice/VoiceOverlayPanels';

// Re-export types for external consumers
export type { VoiceParseResult } from './voice/types';

/**
 * VoiceInput — Production-grade voice-powered transaction entry.
 *
 * This is the slim orchestrator that wires state, the speech hook,
 * and the UI panels together. All heavy logic lives in sub-modules:
 *
 *   voice/types.ts             — Shared interfaces
 *   voice/speechEngine.ts      — Web Speech API type definitions
 *   voice/useSpeechRecognition  — Speech recognition hook
 *   voice/VoiceOverlayPanels   — Listening / Processing / Result / Error UI
 *   voice/MemberAvatar         — Avatar component
 *   lib/deduplicateTranscript   — Transcript cleanup (shared client+server)
 */
export default function VoiceInput({ memberNames, members, groupName, onResult }: VoiceInputProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [state, setState] = useState<VoiceState>('idle');
    const [interimText, setInterimText] = useState('');
    const [finalText, setFinalText] = useState('');
    const [parsedResult, setParsedResult] = useState<VoiceParseResult | null>(null);
    const [errorMsg, setErrorMsg] = useState('');

    const { startListening, stopListening, processTranscript, reset } = useSpeechRecognition({
        memberNames,
        groupName,
        onStateChange: setState,
        onFinalTextChange: setFinalText,
        onInterimTextChange: setInterimText,
        onParsedResult: setParsedResult,
        onError: setErrorMsg,
    });

    // Listen for external trigger (from mic button on the page)
    useEffect(() => {
        const handler = () => setIsOpen(true);
        window.addEventListener('openVoiceInput', handler);
        return () => window.removeEventListener('openVoiceInput', handler);
    }, []);

    // Auto-start when overlay opens
    useEffect(() => {
        if (isOpen && state === 'idle') {
            startListening();
        }
        return () => { stopListening(); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen]);

    // ── Handlers ──

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
        reset();
    }, [stopListening, reset]);

    const handleAccept = useCallback(() => {
        if (parsedResult) {
            onResult(parsedResult);
            if (navigator.vibrate) navigator.vibrate(100);
        }
        handleClose();
    }, [parsedResult, onResult, handleClose]);

    const handleRetry = useCallback(() => {
        stopListening();
        setState('idle');
        setInterimText('');
        setFinalText('');
        setParsedResult(null);
        setErrorMsg('');
        reset();
        setTimeout(() => startListening(), 150);
    }, [stopListening, startListening, reset]);

    if (!isOpen) return null;

    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3, ease: 'easeOut' }}
                style={{
                    position: 'fixed',
                    top: 0, left: 0, right: 0, bottom: 0,
                    zIndex: 10000,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'flex-start',
                    background: 'var(--bg-primary)',
                    overflowY: 'auto',
                    overflowX: 'hidden',
                    WebkitOverflowScrolling: 'touch',
                    paddingTop: 'env(safe-area-inset-top, 20px)',
                    paddingBottom: 'env(safe-area-inset-bottom, 20px)',
                }}
            >
                {/* Close button */}
                <motion.button
                    onClick={handleClose}
                    whileTap={{ scale: 0.9 }}
                    aria-label="Close voice input"
                    style={{
                        position: 'absolute',
                        top: 'calc(env(safe-area-inset-top, 12px) + 12px)',
                        right: 16,
                        width: 40, height: 40, borderRadius: 20,
                        background: 'var(--surface-card)',
                        border: '1px solid var(--border-default)',
                        color: 'var(--fg-tertiary)',
                        cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                >
                    <X size={18} />
                </motion.button>

                {/* State panels */}
                {state === 'listening' && (
                    <ListeningPanel
                        finalText={finalText}
                        interimText={interimText}
                        onDone={handleDone}
                    />
                )}

                {state === 'processing' && (
                    <ProcessingPanel transcript={finalText} />
                )}

                {state === 'result' && parsedResult && (
                    <ResultPanel
                        result={parsedResult}
                        members={members}
                        onRetry={handleRetry}
                        onAccept={handleAccept}
                    />
                )}

                {state === 'error' && (
                    <ErrorPanel
                        message={errorMsg}
                        onRetry={handleRetry}
                        onClose={handleClose}
                    />
                )}
            </motion.div>
        </AnimatePresence>
    );
}
