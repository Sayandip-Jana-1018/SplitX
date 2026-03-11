/** Web Speech API type definitions and browser detection utility. */

export interface SpeechRecognitionResult {
    readonly isFinal: boolean;
    readonly length: number;
    [index: number]: { transcript: string; confidence: number };
}

export interface SpeechRecognitionResultList {
    readonly length: number;
    [index: number]: SpeechRecognitionResult;
}

export interface SpeechRecognitionEvent extends Event {
    readonly results: SpeechRecognitionResultList;
    readonly resultIndex: number;
}

export interface SpeechRecognitionErrorEvent extends Event {
    readonly error: string;
}

export interface SpeechRecognitionInstance extends EventTarget {
    continuous: boolean;
    interimResults: boolean;
    lang: string;
    maxAlternatives: number;
    onstart: ((this: SpeechRecognitionInstance, ev: Event) => void) | null;
    onresult: ((this: SpeechRecognitionInstance, ev: SpeechRecognitionEvent) => void) | null;
    onerror: ((this: SpeechRecognitionInstance, ev: SpeechRecognitionErrorEvent) => void) | null;
    onend: ((this: SpeechRecognitionInstance, ev: Event) => void) | null;
    onspeechend: ((this: SpeechRecognitionInstance, ev: Event) => void) | null;
    start(): void;
    stop(): void;
    abort(): void;
}

/** Returns the browser's SpeechRecognition constructor, or null if unsupported. */
export function getSpeechRecognition(): (new () => SpeechRecognitionInstance) | null {
    if (typeof window === 'undefined') return null;
    const w = window as unknown as {
        SpeechRecognition: new () => SpeechRecognitionInstance;
        webkitSpeechRecognition: new () => SpeechRecognitionInstance;
    };
    return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}
