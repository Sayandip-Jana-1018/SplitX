/** Shared voice input types used across the voice feature modules. */

export interface VoiceMember {
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

export interface MemberInfo {
    name: string;
    image?: string | null;
}

export interface VoiceInputProps {
    memberNames: string[];
    members?: MemberInfo[];
    groupName: string;
    onResult: (result: VoiceParseResult) => void;
}

export type VoiceState = 'idle' | 'listening' | 'processing' | 'result' | 'error';
