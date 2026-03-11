/**
 * Deduplicate a transcript that has repeated words/phrases from mobile
 * speech engine (e.g. "split split split 542 542 542" → "split 542").
 *
 * Shared between client-side (VoiceInput) and server-side (parse-voice API).
 */
export function deduplicateTranscript(raw: string): string {
    if (!raw) return '';
    const words = raw.trim().split(/\s+/);
    if (words.length <= 3) return raw.trim();

    // Strategy 1: Detect repeated phrases (2-6 word patterns)
    for (let patternLen = 6; patternLen >= 2; patternLen--) {
        if (words.length < patternLen * 2) continue;
        const pattern = words.slice(0, patternLen).join(' ').toLowerCase();
        let count = 0;
        for (let i = 0; i <= words.length - patternLen; i += patternLen) {
            const chunk = words.slice(i, i + patternLen).join(' ').toLowerCase();
            if (chunk === pattern) count++;
            else break;
        }
        if (count >= 3) {
            return words.slice(0, patternLen).join(' ');
        }
    }

    // Strategy 2: Remove consecutive duplicate words (keep one)
    const cleaned: string[] = [words[0]];
    let consecutiveCount = 0;
    for (let i = 1; i < words.length; i++) {
        if (words[i].toLowerCase() === words[i - 1].toLowerCase()) {
            consecutiveCount++;
            if (consecutiveCount >= 2) continue;
        } else {
            consecutiveCount = 0;
        }
        cleaned.push(words[i]);
    }

    return cleaned.join(' ');
}
