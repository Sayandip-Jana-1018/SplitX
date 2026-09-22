import { afterEach, describe, expect, it, vi } from 'vitest';
import { policyFor } from '@/lib/rateLimit/policies';

describe('policyFor', () => {
    afterEach(() => vi.unstubAllEnvs());

    it.each([
        ['POST', '/api/auth/callback/credentials'],
        ['POST', '/api/register'],
        ['POST', '/api/auth/forgot-password'],
        ['POST', '/api/auth/reset-password'],
    ])('limits credential and email endpoints per device, under a network ceiling: %s %s', (method, path) => {
        // B-025: a class signing up from one campus address is not one person.
        expect(policyFor(method, path)).toMatchObject({ name: 'auth', limit: 10, keyBy: 'identity', networkLimit: 240 });
    });

    it.each([
        ['GET', '/api/auth/session'],
        ['GET', '/api/auth/csrf'],
        ['GET', '/api/auth/providers'],
        ['GET', '/api/health/live'],
        ['GET', '/api/health/ready'],
        ['GET', '/api/metrics'],
        ['GET', '/dashboard'],
        ['GET', '/_next/data/abc.json'],
    ])('never limits %s %s', (method, path) => {
        expect(policyFor(method, path)).toBeNull();
    });

    it('gives the CPU-heavy settlement preview its own tighter limit, per identity', () => {
        expect(policyFor('POST', '/api/settlements/preview')).toMatchObject({ name: 'preview', limit: 60, keyBy: 'identity' });
    });

    it.each([
        ['GET', '/api/groups'],
        ['POST', '/api/transactions'],
        ['GET', '/api/health'],
        ['GET', '/api/register'],
    ])('applies the general API limit per identity to %s %s', (method, path) => {
        expect(policyFor(method, path)).toMatchObject({ name: 'api', limit: 120, keyBy: 'identity', windowMs: 60_000 });
    });

    it('reads per-environment limits and ignores invalid values', () => {
        vi.stubEnv('RATE_LIMIT_API_PER_MINUTE', '600');
        vi.stubEnv('RATE_LIMIT_AUTH_PER_MINUTE', '5');
        vi.stubEnv('RATE_LIMIT_PREVIEW_PER_MINUTE', 'nope');
        vi.stubEnv('RATE_LIMIT_AUTH_NETWORK_PER_MINUTE', '500');
        expect(policyFor('POST', '/api/register')?.networkLimit).toBe(500);
        expect(policyFor('GET', '/api/groups')?.limit).toBe(600);
        expect(policyFor('POST', '/api/register')?.limit).toBe(5);
        expect(policyFor('POST', '/api/settlements/preview')?.limit).toBe(60);
    });
});
