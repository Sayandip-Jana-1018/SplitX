/**
 * The live site's checks (uptime.yml, D-106): what production is asked, and
 * what counts as a good answer. The monitoring stack only runs on the Kind
 * runs and the AWS days, so without these nothing would notice the site that
 * real people use going down. Kept free of I/O so the unit tests hold the rules.
 */

export const PRODUCTION = 'https://splitsj.vercel.app';

/** A year: the least HSTS max-age worth having (the app sends two). */
const HSTS_MIN_SECONDS = 31_536_000;

/**
 * Every check, in the order the report lists them. The database check wakes
 * Neon's compute when it sleeps, so the workflow asks it once an hour, not
 * every 15 minutes: a check that kept the database awake would spend the free
 * plan's compute hours on itself.
 */
export const CHECKS = [
    { name: 'live', what: 'The app answers, without the database', path: '/api/health/live' },
    { name: 'home', what: 'The home page', path: '/' },
    { name: 'scripts', what: 'The page\'s own JavaScript is served', path: null },
    { name: 'headers', what: 'HSTS, nosniff and a Content Security Policy', path: null },
    { name: 'sign-in', what: 'The sign-in page', path: '/login' },
    { name: 'database', what: 'The database answers', path: '/api/health/ready', hourly: true },
];

const json = (body) => {
    try {
        return JSON.parse(body);
    } catch {
        return null;
    }
};

const titled = (body) => /<title>[^<]*SplitX[^<]*<\/title>/.test(body);

/** The first of the page's own scripts (`/_next/static/…js`), or null. */
export function firstScript(html) {
    const match = /\/_next\/static\/[\w./-]+\.js/.exec(html);
    return match ? match[0] : null;
}

/**
 * What a response says about one check. `answer` is { status, headers, body }
 * with lower-case header names; null when there was no answer at all.
 * @returns {{ ok: boolean, detail: string }}
 */
export function judge(name, answer) {
    if (!answer) return { ok: false, detail: 'no answer' };
    if (answer.error) return { ok: false, detail: answer.error };
    const { status, headers = {}, body = '' } = answer;
    const wrongStatus = (expected) => ({ ok: false, detail: 'HTTP ' + status + ', expected ' + expected });
    switch (name) {
        case 'live': {
            if (status !== 200) return wrongStatus(200);
            return json(body)?.status === 'alive' ? { ok: true, detail: 'alive' } : { ok: false, detail: 'HTTP 200, but not "alive"' };
        }
        case 'home':
        case 'sign-in': {
            if (status !== 200) return wrongStatus(200);
            return titled(body) ? { ok: true, detail: 'the page, titled SplitX' } : { ok: false, detail: 'HTTP 200, but not SplitX\'s page' };
        }
        case 'scripts': {
            if (status !== 200) return wrongStatus(200);
            return /javascript/.test(headers['content-type'] ?? '')
                ? { ok: true, detail: 'served as JavaScript' }
                : { ok: false, detail: 'served as ' + (headers['content-type'] || 'nothing') };
        }
        case 'headers': {
            const problems = [];
            const hsts = /max-age=(\d+)/.exec(headers['strict-transport-security'] ?? '');
            if (!hsts || Number(hsts[1]) < HSTS_MIN_SECONDS) problems.push('no HSTS of a year or more');
            if ((headers['x-content-type-options'] ?? '').toLowerCase() !== 'nosniff') problems.push('no nosniff');
            const enforced = Boolean(headers['content-security-policy']);
            if (!enforced && !headers['content-security-policy-report-only']) problems.push('no Content Security Policy');
            if (problems.length) return { ok: false, detail: problems.join(', ') };
            return { ok: true, detail: 'HSTS, nosniff, CSP ' + (enforced ? 'enforced' : 'report-only') };
        }
        case 'database': {
            const answerBody = json(body);
            if (status === 200 && answerBody?.status === 'ready' && answerBody.checks?.database === 'ok') return { ok: true, detail: 'ready' };
            return { ok: false, detail: 'HTTP ' + status + (answerBody?.checks?.database ? ', database ' + answerBody.checks.database : '') };
        }
        default:
            throw new Error('no such check: ' + name);
    }
}

/** One line of the report, as the job log prints it. */
export function reportLine(result) {
    return (result.ok ? 'PASS' : 'FAIL') + '  ' + result.name + ' — ' + result.detail
        + (result.ms === undefined ? '' : ' (' + result.ms + ' ms)') + (result.retried ? ', on the second try' : '');
}

/** The run's summary, as a Markdown table. */
export function summaryTable(results, at) {
    const failed = results.filter((result) => !result.ok);
    return [
        '### The live site, ' + at,
        '',
        failed.length ? '**' + failed.length + ' of ' + results.length + ' checks failed.**' : 'All ' + results.length + ' checks passed.',
        '',
        '| Check | Result | Detail |',
        '|---|---|---|',
        ...results.map((result) => '| ' + result.what + ' | ' + (result.ok ? 'pass' : '**fail**') + ' | '
            + result.detail + (result.ms === undefined ? '' : ', ' + result.ms + ' ms') + (result.retried ? ', second try' : '') + ' |'),
        '',
    ].join('\n');
}

export const INCIDENT_PREFIX = 'Production check failing';

/**
 * What to do about the incident issue: open one when checks fail and none is
 * open, close the open one when every check passes, or nothing.
 * @param {{ number: number, title: string, created_at: string, user?: { login: string } }[]} openIssues
 */
export function incidentAction(openIssues, results) {
    const incident = openIssues.find((issue) => issue.title.startsWith(INCIDENT_PREFIX) && issue.user?.login === 'github-actions[bot]') ?? null;
    const failed = results.filter((result) => !result.ok);
    if (failed.length && !incident) return { action: 'open', title: INCIDENT_PREFIX + ': ' + failed.map((result) => result.name).join(', ') };
    if (!failed.length && incident) return { action: 'close', issue: incident };
    return { action: 'none', issue: incident };
}

/** The comment that closes an incident, with how long it lasted (whole minutes, from the issue's opening). */
export function recoveryComment(issue, now, runUrl) {
    const minutes = Math.max(1, Math.round((Date.parse(now) - Date.parse(issue.created_at)) / 60_000));
    return 'Recovered: every check passed at ' + now + ' ([run](' + runUrl + ')). The checks had been failing for about '
        + minutes + ' minute' + (minutes === 1 ? '' : 's') + ' since this issue opened.';
}
