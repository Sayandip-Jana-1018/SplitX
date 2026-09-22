import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { siteUrl } from '@/lib/siteUrl';

describe('siteUrl', () => {
    beforeEach(() => {
        vi.stubEnv('NEXTAUTH_URL', '');
        vi.stubEnv('AUTH_URL', '');
        vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', '');
    });
    afterEach(() => vi.unstubAllEnvs());

    const request = new Request('https://splitx-git-branch.vercel.app/api/contacts/invite', { method: 'POST' });

    it('prefers the configured address, without a trailing slash', () => {
        vi.stubEnv('NEXTAUTH_URL', 'https://splitx.example/');
        vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', 'splitx-app.vercel.app');
        expect(siteUrl(request)).toBe('https://splitx.example');
    });

    it('on Vercel without one, uses the production domain Vercel sets', () => {
        vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', 'splitx-app.vercel.app');
        expect(siteUrl(request)).toBe('https://splitx-app.vercel.app');
    });

    it('otherwise uses the address the request came in on, and never invents localhost', () => {
        expect(siteUrl(request)).toBe('https://splitx-git-branch.vercel.app');
        expect(siteUrl()).toBeNull();
    });
});
