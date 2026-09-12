/**
 * Mobile speech engines (Android Chrome especially) re-emit phrases they have
 * already delivered, so a clean "split 450 between Ankan and Ankit" arrives as
 * "split split split 450 between between Ankan and Ankit".
 *
 * This collapses any phrase that repeats back-to-back, longest phrase first,
 * so both word-level and phrase-level echoes disappear while genuine speech
 * survives untouched.
 *
 * Shared by the voice hook (client) and the parse-voice API (server).
 */

const MAX_PHRASE = 6;

function sameWords(a: string[], b: string[]) {
    for (let i = 0; i < a.length; i++) {
        if (a[i].toLowerCase() !== b[i].toLowerCase()) return false;
    }
    return true;
}

export function deduplicateTranscript(raw: string): string {
    if (!raw) return '';
    let words = raw.trim().split(/\s+/).filter(Boolean);
    if (words.length < 2) return words.join(' ');

    for (let size = MAX_PHRASE; size >= 1; size--) {
        if (words.length < size * 2) continue;
        const out: string[] = [];
        let index = 0;
        while (index < words.length) {
            const phrase = words.slice(index, index + size);
            if (phrase.length < size) {
                out.push(...words.slice(index));
                break;
            }
            out.push(...phrase);
            let next = index + size;
            while (next + size <= words.length && sameWords(words.slice(next, next + size), phrase)) {
                next += size;
            }
            index = next;
        }
        words = out;
    }

    return words.join(' ');
}
