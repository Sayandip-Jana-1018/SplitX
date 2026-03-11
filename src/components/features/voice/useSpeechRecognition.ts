'use client';

import { useRef, useCallback, useEffect } from 'react';
import { deduplicateTranscript } from '@/lib/deduplicateTranscript';
import { getSpeechRecognition } from './speechEngine';
import type { SpeechRecognitionInstance, SpeechRecognitionEvent, SpeechRecognitionErrorEvent } from './speechEngine';
import type { VoiceState, VoiceParseResult } from './types';

/**
 * useSpeechRecognition — Custom hook encapsulating the Web Speech API.
 *
 * Uses single-utterance mode (continuous=false) to prevent the mobile
 * Chrome duplication bug where continuous mode loops and re-processes
 * the same audio buffer.
 */

interface UseSpeechRecognitionOptions {
    memberNames: string[];
    groupName: string;
    onStateChange: (state: VoiceState) => void;
    onFinalTextChange: (text: string) => void;
    onInterimTextChange: (text: string) => void;
    onParsedResult: (result: VoiceParseResult) => void;
    onError: (msg: string) => void;
}

export function useSpeechRecognition({
    memberNames,
    groupName,
    onStateChange,
    onFinalTextChange,
    onInterimTextChange,
    onParsedResult,
    onError,
}: UseSpeechRecognitionOptions) {
    const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
    const stateRef = useRef<VoiceState>('idle');
    const finalTextRef = useRef('');
    const processingRef = useRef(false);
    const memberNamesRef = useRef(memberNames);
    const groupNameRef = useRef(groupName);
    memberNamesRef.current = memberNames;
    groupNameRef.current = groupName;

    // Keep stateRef in sync with external state
    const syncState = useCallback((s: VoiceState) => {
        stateRef.current = s;
        onStateChange(s);
    }, [onStateChange]);

    const stopListening = useCallback(() => {
        if (recognitionRef.current) {
            try { recognitionRef.current.abort(); } catch { /* already stopped */ }
            recognitionRef.current = null;
        }
    }, []);

    const processTranscript = useCallback(async () => {
        if (processingRef.current) return;
        processingRef.current = true;

        let transcript = finalTextRef.current.trim();
        transcript = deduplicateTranscript(transcript);

        if (!transcript) {
            syncState('error');
            onError('No speech detected. Please try again and speak clearly.');
            processingRef.current = false;
            return;
        }

        syncState('processing');
        onInterimTextChange('');
        stopListening();
        if (navigator.vibrate) navigator.vibrate([30, 50, 30]);

        try {
            const res = await fetch('/api/ai/parse-voice', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ transcript, memberNames: memberNamesRef.current, groupName: groupNameRef.current }),
            });

            if (!res.ok) throw new Error('Parse request failed');

            const result: VoiceParseResult = await res.json();
            onParsedResult(result);
            syncState('result');
            if (navigator.vibrate) navigator.vibrate([50, 100, 50]);
        } catch (err) {
            console.error('Parse error:', err);
            syncState('error');
            onError('Could not understand the expense. Please try again.');
        } finally {
            processingRef.current = false;
        }
    }, [syncState, onInterimTextChange, onParsedResult, onError, stopListening]);

    const startListening = useCallback(() => {
        const SR = getSpeechRecognition();
        if (!SR) {
            syncState('error');
            onError('Voice input is not supported in this browser. Please use Chrome or Edge.');
            return;
        }

        try {
            const recognition = new SR();
            // Single-utterance mode prevents mobile Chrome duplication.
            recognition.continuous = false;
            recognition.interimResults = true;
            recognition.lang = 'en-IN';
            recognition.maxAlternatives = 1;

            // Reset
            finalTextRef.current = '';
            processingRef.current = false;

            recognition.onstart = () => {
                syncState('listening');
                onInterimTextChange('');
                onFinalTextChange('');
                finalTextRef.current = '';
                if (navigator.vibrate) navigator.vibrate(50);
            };

            recognition.onresult = (event: SpeechRecognitionEvent) => {
                let interim = '';
                let finalResult = '';

                for (let i = 0; i < event.results.length; i++) {
                    const result = event.results[i];
                    if (result.isFinal) {
                        finalResult += result[0].transcript;
                    } else {
                        interim += result[0].transcript;
                    }
                }

                if (finalResult) {
                    finalTextRef.current = finalResult.trim();
                    onFinalTextChange(finalTextRef.current);
                    onInterimTextChange('');
                }
                if (interim) {
                    onInterimTextChange(interim);
                }
            };

            recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
                console.error('Speech error:', event.error);
                if (event.error === 'not-allowed') {
                    syncState('error');
                    onError('Microphone access denied. Please allow microphone access in your browser settings.');
                } else if (event.error === 'no-speech') {
                    syncState('error');
                    onError('No speech detected. Tap the mic and speak clearly.');
                } else if (event.error !== 'aborted') {
                    syncState('error');
                    onError(`Voice recognition error: ${event.error}. Please try again.`);
                }
            };

            recognition.onend = () => {
                if (stateRef.current === 'listening' && !processingRef.current) {
                    const transcript = finalTextRef.current.trim();
                    if (transcript) {
                        processTranscript();
                    }
                }
            };

            recognitionRef.current = recognition;
            recognition.start();
        } catch (err) {
            console.error('Failed to start recognition:', err);
            syncState('error');
            onError('Could not start voice recognition. Please try again.');
        }
    }, [syncState, onFinalTextChange, onInterimTextChange, onError, processTranscript]);

    // Cleanup on unmount
    useEffect(() => {
        return () => { stopListening(); };
    }, [stopListening]);

    const reset = useCallback(() => {
        finalTextRef.current = '';
        processingRef.current = false;
    }, []);

    return {
        startListening,
        stopListening,
        processTranscript,
        reset,
    };
}
