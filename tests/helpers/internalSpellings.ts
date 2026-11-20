/**
 * Spellings of the two internal paths. The proxy decodes, lower-cases and
 * collapses slashes before it compares (src/lib/security/internalPaths.ts), so
 * each must be recognised as internal, never passed on (D-043, D-114).
 */
export const INTERNAL_SPELLINGS = [
    '/api/metrics',
    '/api/health/ready',
    '/API/Metrics',
    '/api//metrics',
    '/api/metrics/',
    '/api/%6detrics',
    '//api/health/ready',
    '/api/health/ready/',
];
