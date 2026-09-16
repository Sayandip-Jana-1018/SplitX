import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { previewMaxInFlight, previewsInFlight, releasePreview, resetPreviewAdmissions, tryAdmitPreview } from '@/lib/previewAdmission';

describe('preview admission', () => {
    beforeEach(() => resetPreviewAdmissions());
    afterEach(() => vi.unstubAllEnvs());

    it('admits up to eight at once by default, then refuses', () => {
        expect(previewMaxInFlight()).toBe(8);
        const results = Array.from({ length: 10 }, (_, i) => tryAdmitPreview('r' + i));
        expect(results).toEqual([true, true, true, true, true, true, true, true, false, false]);
        expect(previewsInFlight()).toBe(8);
    });

    it('frees a slot when a request finishes', () => {
        for (let i = 0; i < 8; i++) tryAdmitPreview('r' + i);
        expect(tryAdmitPreview('late')).toBe(false);
        releasePreview('r3');
        expect(tryAdmitPreview('late')).toBe(true);
    });

    it('follows PREVIEW_MAX_IN_FLIGHT, ignoring nonsense', () => {
        vi.stubEnv('PREVIEW_MAX_IN_FLIGHT', '2');
        expect([tryAdmitPreview('a'), tryAdmitPreview('b'), tryAdmitPreview('c')]).toEqual([true, true, false]);
        vi.stubEnv('PREVIEW_MAX_IN_FLIGHT', 'lots');
        expect(previewMaxInFlight()).toBe(8);
    });

    it('expires an admission nobody released after a minute, instead of losing the slot forever', () => {
        const start = 1_788_000_000_000;
        for (let i = 0; i < 8; i++) tryAdmitPreview('stuck' + i, start);
        expect(tryAdmitPreview('next', start + 59_000)).toBe(false);
        expect(tryAdmitPreview('next', start + 61_000)).toBe(true);
        expect(previewsInFlight()).toBe(1);
    });

    it('treats releasing an unknown or missing admission as harmless', () => {
        tryAdmitPreview('kept');
        releasePreview('never-admitted');
        releasePreview(null);
        releasePreview(undefined);
        expect(previewsInFlight()).toBe(1);
    });
});
