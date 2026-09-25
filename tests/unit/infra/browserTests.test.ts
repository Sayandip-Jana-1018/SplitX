import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/*
 * The browser tests (tests/e2e, D-107) run in CI's e2e job. What makes them
 * worth having is where they run: a production build (the service worker and
 * the secure session cookie exist only there), a real Postgres and Redis, and
 * a release that waits for them. These checks keep it that way.
 */

const ci = readFileSync('.github/workflows/ci.yml', 'utf8').replaceAll('\r\n', '\n');
const job = ci.slice(ci.indexOf('\n  e2e:\n'), ci.indexOf('\n  secret-scan:\n'));

describe('the e2e job', () => {
    it('serves a production build, and tests it', () => {
        expect(job).toContain('run: npm run build');
        expect(job).toContain('nohup npx next start -p 3000');
        expect(job).toContain('run: npx playwright test');
        expect(job).toContain('E2E_BASE_URL: http://localhost:3000');
    });

    it('runs on a real Postgres of production\'s version, migrated, and a real Redis', () => {
        expect(job).toContain('image: postgres:17.11-alpine3.24@sha256:');
        expect(job).toContain('run: npx prisma migrate deploy');
        expect(job).toContain('REDIS_URL: redis://127.0.0.1:6379/0');
    });

    it('uses no repository secret: its session secret is made for the run, and masked', () => {
        expect(job).not.toContain('secrets.');
        expect(job).toContain('echo "::add-mask::$secret"');
    });

    it('is one of the jobs a release waits for', () => {
        const needs = /\n {2}release:\n[\s\S]*?\n {4}needs: \[([^\]]+)\]/.exec(ci)?.[1].split(',').map((name) => name.trim());
        expect(needs).toContain('e2e');
    });

    it('keeps the report when something fails', () => {
        expect(job).toContain("if: ${{ !cancelled() }}");
        expect(job).toMatch(/path: \|\n {12}playwright-report\/\n {12}test-results\/\n {12}next\.log/);
    });
});

describe('the Content Security Policy (D-108)', () => {
    const config = readFileSync('next.config.ts', 'utf8');

    it('is enforced in production, not only reported', () => {
        expect(config).toContain("{ key: 'Content-Security-Policy', value: CONTENT_SECURITY_POLICY }");
        expect(config).not.toContain('Content-Security-Policy-Report-Only');
    });

    it('fails a browser test on any violation, on any of its phones', () => {
        const support = readFileSync('tests/e2e/support.ts', 'utf8');
        expect(support).toContain("document.addEventListener('securitypolicyviolation'");
        expect(support).toContain("expect(cspViolations, 'what the Content Security Policy refused').toEqual([]);");
        for (const spec of readdirSync('tests/e2e').filter((file) => file.endsWith('.spec.ts'))) {
            expect(readFileSync(`tests/e2e/${spec}`, 'utf8'), spec).toMatch(/import \{[^}]*\btest\b[^}]*\} from '\.\/support';/);
        }
    });
});

describe('the suite', () => {
    const config = readFileSync('playwright.config.ts', 'utf8');

    it('runs one flow at a time on a phone, since the flows share one database', () => {
        expect(config).toContain("testDir: 'tests/e2e'");
        expect(config).toContain('workers: 1');
        expect(config).toContain("...devices['Pixel 7']");
    });

    it('covers the flows the plan names', () => {
        expect(readdirSync('tests/e2e').filter((file) => file.endsWith('.spec.ts'))).toEqual([
            '01-account.spec.ts',
            '02-groups.spec.ts',
            '03-expenses.spec.ts',
            '04-settle.spec.ts',
            '05-members.spec.ts',
            '06-shared-device.spec.ts',
            '07-receipt.spec.ts',
        ]);
    });
});
