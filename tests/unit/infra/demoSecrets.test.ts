import { describe, expect, it } from 'vitest';
import { amzDates, signingKey, signRequest } from '../../../scripts/lib/aws-sigv4.mjs';
import { REQUIRED, demoSecrets, withPool } from '../../../scripts/lib/demo-secrets.mjs';

/** Every required key, with plain made-up values. */
const complete: Record<string, string> = Object.fromEntries(REQUIRED.map((key) => [key, `${key.toLowerCase()}-value`]));
complete.DEMO_DATABASE_URL = 'postgresql://demo:pw@demo-branch.neon.example/splitx?sslmode=require';

describe('what goes into the demo secrets', () => {
    it('names every missing required key at once', () => {
        const { missing, app } = demoSecrets({ NEXTAUTH_SECRET: 'x' });
        expect(app).toBeNull();
        expect(missing).toEqual(REQUIRED.filter((key) => key !== 'NEXTAUTH_SECRET'));
    });

    it('uses the demo branch, never the production database or production Redis', () => {
        const { app } = demoSecrets({
            ...complete,
            DATABASE_URL: 'postgresql://prod:pw@production.neon.example/splitx',
            DIRECT_URL: 'postgresql://prod:pw@production.neon.example/splitx',
            UPSTASH_REDIS_REST_URL: 'https://production-redis.example',
            UPSTASH_REDIS_REST_TOKEN: 'production-token',
        });
        expect(app!.DATABASE_URL).toContain('demo-branch.neon.example');
        expect(app!.DIRECT_URL).toContain('demo-branch.neon.example');
        expect(JSON.stringify(app)).not.toContain('production');
        expect(app!.REDIS_URL).toBe('redis://:redis_password-value@splitx-redis:6379/0');
    });

    it('caps each pod\'s database pool, keeping the URL\'s own settings', () => {
        const url = new URL(withPool(complete.DEMO_DATABASE_URL));
        expect(url.searchParams.get('sslmode')).toBe('require');
        expect(url.searchParams.get('connection_limit')).toBe('5');
        expect(url.searchParams.get('pool_timeout')).toBe('10');
        expect(new URL(withPool(url.toString() + '&x=1')).searchParams.getAll('connection_limit')).toEqual(['5']);
    });

    it('percent-encodes a Redis password that would break the URL', () => {
        const { app } = demoSecrets({ ...complete, REDIS_PASSWORD: 'a@b/c' });
        expect(app!.REDIS_URL).toBe('redis://:a%40b%2Fc@splitx-redis:6379/0');
    });

    it('signs in with GitHub on EKS only through the second OAuth app', () => {
        const withoutApp = demoSecrets({ ...complete, GITHUB_ID: 'vercel-app', GITHUB_SECRET: 'vercel-secret' }).app!;
        expect(withoutApp.GITHUB_ID).toBeUndefined();
        const withApp = demoSecrets({ ...complete, AWS_GITHUB_ID: 'aws-app', AWS_GITHUB_SECRET: 'aws-secret' }).app!;
        expect(withApp.GITHUB_ID).toBe('aws-app');
        expect(withApp.GITHUB_SECRET).toBe('aws-secret');
    });

    it('keeps the platform\'s credentials out of the app\'s secret', () => {
        const { app, platform } = demoSecrets({ ...complete, ALERT_SMTP_USERNAME: 'u', ALERT_SMTP_PASSWORD: 'abcd efgh ijkl mnop', ALERT_EMAIL_TO: 't' });
        for (const key of ['GF_ADMIN_PASSWORD', 'JENKINS_ADMIN_PASSWORD', 'GITHUB_WEBHOOK_SECRET', 'NEXUS_ADMIN_PASSWORD']) {
            expect(app).not.toHaveProperty(key);
            expect(platform).toHaveProperty(key);
        }
        expect(platform!.ALERT_SMTP_PASSWORD).toBe('abcdefghijklmnop');
    });
});

describe('AWS Signature Version 4', () => {
    // AWS's own worked example (the IAM ListUsers request in the SigV4
    // documentation): its credentials are AWS's published example values.
    const credentials = { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY' };

    it('dates a request the way AWS does', () => {
        expect(amzDates(new Date('2015-08-30T12:36:00Z'))).toEqual({ amzDate: '20150830T123600Z', date: '20150830' });
    });

    it('derives the documented signing key', () => {
        expect(signingKey(credentials.secretAccessKey, '20120215', 'us-east-1', 'iam').toString('hex'))
            .toBe('f4780e2d9f65fa895f9c67b32ce1baf0b0d8a43505a000a1a9e090d414db404d');
    });

    it('produces the documented signature', () => {
        const headers = signRequest({
            method: 'GET',
            host: 'iam.amazonaws.com',
            query: 'Action=ListUsers&Version=2010-05-08',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' },
        }, credentials, { region: 'us-east-1', service: 'iam', now: new Date('2015-08-30T12:36:00Z') });
        expect(headers.authorization).toBe('AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/iam/aws4_request, '
            + 'SignedHeaders=content-type;host;x-amz-date, Signature=5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7');
    });

    it('signs a session token when there is one', () => {
        const headers = signRequest({ method: 'POST', host: 'secretsmanager.ap-south-1.amazonaws.com', body: '{}' },
            { ...credentials, sessionToken: 'token' }, { region: 'ap-south-1', service: 'secretsmanager', now: new Date('2026-09-23T18:00:00Z') });
        expect(headers['x-amz-security-token']).toBe('token');
        expect(headers.authorization).toContain('SignedHeaders=host;x-amz-date;x-amz-security-token,');
    });
});
