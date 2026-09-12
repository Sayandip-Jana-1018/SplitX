import { describe, expect, it } from 'vitest';
import { deduplicateTranscript } from '@/lib/deduplicateTranscript';

describe('deduplicateTranscript', () => {
    it.each([
        // The exact echo pattern Android Chrome produced in the voice composer.
        ['split split split split 450 between between ankan ankit and sayandip', 'split 450 between ankan ankit and sayandip'],
        // Whole phrases re-emitted back to back.
        ['split 450 between Ankan split 450 between Ankan', 'split 450 between Ankan'],
        ['dinner at dhaba dinner at dhaba dinner at dhaba 1200', 'dinner at dhaba 1200'],
        // Echoes differ only in case.
        ['Split split 300 with Ankit', 'Split 300 with Ankit'],
        // Irregular whitespace is normalised.
        ['  paid   600  for   cab ', 'paid 600 for cab'],
    ])('collapses echoes: %s', (input, expected) => {
        expect(deduplicateTranscript(input)).toBe(expected);
    });

    it('leaves speech without repetition untouched', () => {
        const clean = 'Ankan paid 450 for pizza split with Ankit and Sayandip';
        expect(deduplicateTranscript(clean)).toBe(clean);
    });

    it('keeps words that repeat non-adjacently', () => {
        expect(deduplicateTranscript('pay 200 to Ankit and 200 to Ankan')).toBe('pay 200 to Ankit and 200 to Ankan');
    });

    it.each(['', '   ', 'hello'])('handles trivial input %j', (input) => {
        expect(deduplicateTranscript(input)).toBe(input.trim());
    });
});
