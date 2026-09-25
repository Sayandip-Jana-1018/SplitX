import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
    CHECKS, firstScript, INCIDENT_PREFIX, incidentAction, judge, PRODUCTION, recoveryComment, reportLine, summaryTable,
} from '../../../scripts/lib/uptime.mjs';

/*
 * The live site's checks (D-106). The answers below have the shapes production
 * gave on 2026-09-25, so a rule that misreads them fails here, not at 3 a.m.
 */

const HEADERS = {
    'content-type': 'text/html; charset=utf-8',
    'strict-transport-security': 'max-age=63072000; includeSubDomains',
    'x-content-type-options': 'nosniff',
    'content-security-policy-report-only': "default-src 'self'; frame-ancestors 'none'",
};
const PAGE = '<html><head><title>SplitX — Split expenses. Settle smarter.</title>'
    + '<script src="/_next/static/chunks/1pud6v14gjs13.js" async></script></head></html>';

describe('what each check accepts', () => {
    it('reads the app as alive only from its own answer', () => {
        expect(judge('live', { status: 200, body: '{"status":"alive","pod":"x","uptimeSeconds":307}' })).toEqual({ ok: true, detail: 'alive' });
        expect(judge('live', { status: 200, body: '<html>a proxy page</html>' }).ok).toBe(false);
        expect(judge('live', { status: 503, body: '' })).toEqual({ ok: false, detail: 'HTTP 503, expected 200' });
    });

    it('wants SplitX\'s own page, not any page', () => {
        expect(judge('home', { status: 200, headers: HEADERS, body: PAGE }).ok).toBe(true);
        expect(judge('sign-in', { status: 200, body: '<title>Example Domain</title>' })).toEqual({ ok: false, detail: 'HTTP 200, but not SplitX\'s page' });
        // A redirect is judged, not followed: the checks ask for pages that answer 200 today.
        expect(judge('home', { status: 307, body: '' }).ok).toBe(false);
    });

    it('finds the page\'s own script, and wants it served as JavaScript', () => {
        expect(firstScript(PAGE)).toBe('/_next/static/chunks/1pud6v14gjs13.js');
        expect(firstScript('<title>SplitX</title>')).toBeNull();
        expect(judge('scripts', { status: 200, headers: { 'content-type': 'application/javascript; charset=UTF-8' }, body: '' }).ok).toBe(true);
        expect(judge('scripts', { status: 200, headers: { 'content-type': 'text/html' }, body: '' }))
            .toEqual({ ok: false, detail: 'served as text/html' });
    });

    it('wants a year of HSTS, nosniff and a Content Security Policy, and says whether it is enforced', () => {
        expect(judge('headers', { status: 200, headers: HEADERS, body: PAGE })).toEqual({ ok: true, detail: 'HSTS, nosniff, CSP report-only' });
        const enforced = { ...HEADERS, 'content-security-policy': "default-src 'self'" };
        expect(judge('headers', { status: 200, headers: enforced, body: PAGE }).detail).toBe('HSTS, nosniff, CSP enforced');
        expect(judge('headers', { status: 200, headers: { 'strict-transport-security': 'max-age=300' }, body: PAGE }))
            .toEqual({ ok: false, detail: 'no HSTS of a year or more, no nosniff, no Content Security Policy' });
    });

    it('reads the database as up only when the app says so', () => {
        expect(judge('database', { status: 200, body: '{"status":"ready","checks":{"database":"ok"},"latencyMs":2}' })).toEqual({ ok: true, detail: 'ready' });
        expect(judge('database', { status: 503, body: '{"status":"not_ready","checks":{"database":"unreachable"}}' }))
            .toEqual({ ok: false, detail: 'HTTP 503, database unreachable' });
    });

    it('fails a check that got no answer, with the reason', () => {
        expect(judge('live', null)).toEqual({ ok: false, detail: 'no answer' });
        expect(judge('live', { error: 'no answer in 15 s' })).toEqual({ ok: false, detail: 'no answer in 15 s' });
        expect(() => judge('uptime', { status: 200 })).toThrow('no such check');
    });

    it('asks the database hourly only, and nothing else of it', () => {
        expect(CHECKS.filter((check) => check.hourly).map((check) => check.name)).toEqual(['database']);
        expect(PRODUCTION).toBe('https://splitsj.vercel.app');
    });
});

describe('the report', () => {
    const results = [
        { name: 'live', what: 'The app answers, without the database', ok: true, detail: 'alive', ms: 312 },
        { name: 'database', what: 'The database answers', ok: false, detail: 'HTTP 503, database unreachable', ms: 2004, retried: true },
    ];

    it('prints one line a check, saying when the second try decided it', () => {
        expect(reportLine(results[0])).toBe('PASS  live — alive (312 ms)');
        expect(reportLine(results[1])).toBe('FAIL  database — HTTP 503, database unreachable (2004 ms), on the second try');
        expect(reportLine({ name: 'headers', ok: true, detail: 'HSTS, nosniff, CSP report-only' })).toBe('PASS  headers — HSTS, nosniff, CSP report-only');
    });

    it('summarises the run as a table', () => {
        const table = summaryTable(results, '2026-09-25T06:18:38Z');
        expect(table).toContain('**1 of 2 checks failed.**');
        expect(table).toContain('| The database answers | **fail** | HTTP 503, database unreachable, 2004 ms, second try |');
        expect(summaryTable([results[0]], 'now')).toContain('All 1 checks passed.');
    });
});

describe('the incident issue', () => {
    const failing = [{ name: 'live', ok: false }, { name: 'database', ok: false }, { name: 'home', ok: true }];
    const passing = [{ name: 'live', ok: true }];
    const incident = { number: 7, title: INCIDENT_PREFIX + ': live', created_at: '2026-09-25T06:00:00Z', user: { login: 'github-actions[bot]' } };

    it('is opened once, naming what failed', () => {
        expect(incidentAction([], failing)).toEqual({ action: 'open', title: 'Production check failing: live, database' });
        expect(incidentAction([incident], failing)).toEqual({ action: 'none', issue: incident });
    });

    it('is closed when every check passes again', () => {
        expect(incidentAction([incident], passing)).toEqual({ action: 'close', issue: incident });
        expect(incidentAction([], passing)).toEqual({ action: 'none', issue: null });
    });

    it('is only ever the run\'s own issue', () => {
        const someoneElses = { ...incident, user: { login: 'Sayandip-Jana-1018' } };
        const another = { ...incident, title: 'Bump next from 16.0.0 to 16.0.1' };
        expect(incidentAction([someoneElses, another], passing)).toEqual({ action: 'none', issue: null });
        expect(incidentAction([someoneElses, another], failing).action).toBe('open');
    });

    it('closes with how long the checks had been failing', () => {
        expect(recoveryComment(incident, '2026-09-25T06:45:00Z', 'https://example.test/run'))
            .toBe('Recovered: every check passed at 2026-09-25T06:45:00Z ([run](https://example.test/run)). '
                + 'The checks had been failing for about 45 minutes since this issue opened.');
        expect(recoveryComment(incident, '2026-09-25T06:00:20Z', 'u')).toContain('about 1 minute since');
    });
});

describe('the workflow', () => {
    const workflow = readFileSync('.github/workflows/uptime.yml', 'utf8');

    it('asks the database on the hourly schedule, and on every run not from a schedule', () => {
        expect(workflow).toContain("- cron: '7 * * * *'");
        expect(workflow).toContain("WITH_DATABASE: ${{ github.event_name != 'schedule' || github.event.schedule == '7 * * * *' }}");
        expect(workflow).toContain("- cron: '22,37,52 * * * *'");
    });

    it('runs at once when the checks change', () => {
        for (const path of ['.github/workflows/uptime.yml', 'scripts/uptime.mjs', 'scripts/lib/uptime.mjs']) expect(workflow).toContain('      - ' + path);
    });

    it('may read the code and write issues, nothing else, and pins every action by commit', () => {
        expect(workflow).toMatch(/permissions:\n {2}contents: read\n {2}issues: write/);
        const uses = [...workflow.matchAll(/uses: (\S+)/g)].map((match) => match[1]);
        expect(uses.length).toBeGreaterThan(0);
        for (const action of uses) expect(action).toMatch(/@[0-9a-f]{40}$/);
    });
});
