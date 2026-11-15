import { describe, expect, it } from 'vitest';
import { drillSummary, judgeDrill, parseFingerprint } from '../../../scripts/lib/restoreDrill.mjs';

/* The restore drill's verdict (Phase 3). Fingerprints in the shape scripts/restore-drill.sql prints. */

const PRODUCTION = [
    'table|Group|0f343b0931126a20f133d67c2b018a3b',
    'table|SplitItem|9e107d9d372bb6826bd81d3542a419d6',
    'table|Transaction|e4d909c290d0fb1ca068ffaddf22cbd0',
    'balances|d41d8cd98f00b204e9800998ecf8427e',
    'unbalanced-groups|0',
].join('\n');

describe('the restore drill', () => {
    it('reads a fingerprint by table and by check', () => {
        const entries = parseFingerprint(PRODUCTION + '\r\n');
        expect(entries.get('table SplitItem')).toBe('9e107d9d372bb6826bd81d3542a419d6');
        expect(entries.get('unbalanced-groups')).toBe('0');
    });

    it('passes a copy identical to production', () => {
        const result = judgeDrill(PRODUCTION, PRODUCTION, PRODUCTION);
        expect(result).toMatchObject({ ok: true, verdict: 'restored' });
        expect(result.lines).toContain('same       SplitItem');
    });

    it('fails a copy with one table changed, and says which', () => {
        const copy = PRODUCTION.replace('9e107d9d372bb6826bd81d3542a419d6', '00000000000000000000000000000000');
        const result = judgeDrill(PRODUCTION, PRODUCTION, copy);
        expect(result).toMatchObject({ ok: false, verdict: 'different' });
        expect(result.lines).toContain('DIFFERENT  SplitItem');
        expect(result.lines).toContain('same       Transaction');
    });

    it('fails a copy missing a table, or with one production lacks', () => {
        const missing = PRODUCTION.split('\n').filter((line) => !line.includes('|Group|')).join('\n');
        expect(judgeDrill(PRODUCTION, PRODUCTION, missing).lines).toContain('DIFFERENT  Group');
        const extra = PRODUCTION + '\ntable|Stray|abc';
        expect(judgeDrill(PRODUCTION, PRODUCTION, extra).lines).toContain('DIFFERENT  Stray (only in the copy)');
    });

    it('fails a copy whose groups don’t net to zero, even when everything matches', () => {
        const odd = PRODUCTION.replace('unbalanced-groups|0', 'unbalanced-groups|2');
        expect(judgeDrill(odd, odd, odd)).toMatchObject({ ok: false, verdict: 'unbalanced' });
    });

    it('judges nothing when production changed during the drill, and nothing when it read nothing', () => {
        const later = PRODUCTION.replace('e4d909c290d0fb1ca068ffaddf22cbd0', 'ffffffffffffffffffffffffffffffff');
        expect(judgeDrill(PRODUCTION, later, PRODUCTION)).toMatchObject({ ok: false, verdict: 'moved' });
        expect(judgeDrill('', '', '')).toMatchObject({ ok: false, verdict: 'empty' });
    });

    it('never prints a hash: the logs of a public repository are public', () => {
        const copy = PRODUCTION.replace('9e107d9d372bb6826bd81d3542a419d6', '00000000000000000000000000000000');
        const summary = drillSummary(judgeDrill(PRODUCTION, PRODUCTION, copy), '2026-11-15T06:00:00Z');
        expect(summary).not.toMatch(/[0-9a-f]{32}/);
        expect(summary).toContain('The restored copy differs from production.');
    });
});
