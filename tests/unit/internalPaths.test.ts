import { describe, expect, it } from 'vitest';
import { isInternalPath } from '@/lib/security/internalPaths';
import { INTERNAL_SPELLINGS } from '../../scripts/lib/platform-checks.mjs';

describe('the internal paths, however they are spelled (D-043, D-114)', () => {
    it.each(INTERNAL_SPELLINGS)('knows %s', (path) => {
        expect(isInternalPath(path)).toBe(true);
    });

    it.each(['/', '/api/health', '/api/health/live', '/api/metricsx', '/api/health/readyz', '/scale', '/api/%E0%A4%A'])(
        'leaves %s alone',
        (path) => {
            expect(isInternalPath(path)).toBe(false);
        },
    );
});
