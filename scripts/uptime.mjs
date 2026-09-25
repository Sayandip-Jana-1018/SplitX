#!/usr/bin/env node
/**
 * Checks the live site (D-106): from GitHub's runners every 15 minutes
 * (.github/workflows/uptime.yml), or by hand:
 *
 *   node scripts/uptime.mjs              every check but the database
 *   node scripts/uptime.mjs --database   the database too
 *   node scripts/uptime.mjs --incidents  also open or close the incident issue (the workflow does)
 *
 * A failed check is asked again once, 20 s later, so a blip, or Neon waking its
 * compute, is not an incident. The run fails when a check fails twice. What the
 * checks decide is in scripts/lib/uptime.mjs.
 */
import { appendFileSync } from 'node:fs';
import { CHECKS, PRODUCTION, firstScript, incidentAction, judge, recoveryComment, reportLine, summaryTable } from './lib/uptime.mjs';

const BASE = process.env.UPTIME_BASE || PRODUCTION;
const WITH_DATABASE = process.argv.includes('--database') || process.env.WITH_DATABASE === 'true';
const INCIDENTS = process.argv.includes('--incidents');
const TIMEOUT_MS = 15_000;
const RETRY_AFTER_MS = 20_000;
const now = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');

/** One request, answered or not; never throws. */
async function ask(path) {
    const started = performance.now();
    const took = () => Math.round(performance.now() - started);
    try {
        const response = await fetch(new URL(path, BASE), {
            headers: { 'user-agent': 'splitx-uptime (github.com/Sayandip-Jana-1018/SplitX)' },
            // A redirect is an answer to judge, not something to follow.
            redirect: 'manual',
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        const body = await response.text();
        return { status: response.status, headers: Object.fromEntries(response.headers), body, ms: took() };
    } catch (error) {
        const why = error.name === 'TimeoutError' ? 'no answer in ' + TIMEOUT_MS / 1000 + ' s' : 'no answer (' + (error.cause?.code ?? error.name) + ')';
        return { error: why, ms: took() };
    }
}

/** The named checks, in CHECKS' order. The home page is asked once for the three that read it. */
async function run(names) {
    const wanted = CHECKS.filter((check) => names.includes(check.name));
    const home = wanted.some((check) => ['home', 'scripts', 'headers'].includes(check.name)) ? await ask('/') : null;
    const results = [];
    for (const check of wanted) {
        let answer;
        let ms;
        if (check.name === 'home') {
            answer = home;
            ms = home.ms;
        } else if (check.name === 'headers') {
            answer = home;
        } else if (check.name === 'scripts') {
            const pageServed = !home.error && home.status === 200;
            const script = pageServed ? firstScript(home.body) : null;
            if (script) answer = await ask(script);
            else answer = { error: pageServed ? 'no script of its own on the home page' : 'not asked: the home page failed' };
            ms = answer.ms;
        } else {
            answer = await ask(check.path);
            ms = answer.ms;
        }
        results.push({ name: check.name, what: check.what, ...judge(check.name, answer), ms });
    }
    return results;
}

let results = await run(CHECKS.filter((check) => !check.hourly || WITH_DATABASE).map((check) => check.name));
const failed = results.filter((result) => !result.ok).map((result) => result.name);
if (failed.length) {
    console.log(failed.length + ' check(s) failed (' + failed.join(', ') + '); asking again in ' + RETRY_AFTER_MS / 1000 + ' s');
    await new Promise((resolve) => setTimeout(resolve, RETRY_AFTER_MS));
    const again = await run(failed);
    results = results.map((result) => (result.ok ? result : { ...again.find((retry) => retry.name === result.name), retried: true }));
}

const at = now();
console.log('The live site, ' + BASE + ', at ' + at + ':');
for (const result of results) console.log('  ' + reportLine(result));
const passed = results.filter((result) => result.ok).length;
console.log(passed === results.length ? 'All ' + results.length + ' checks passed.' : (results.length - passed) + ' of ' + results.length + ' checks failed.');
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summaryTable(results, at));

if (INCIDENTS) {
    const repository = process.env.GITHUB_REPOSITORY;
    const github = async (method, path, body) => {
        const response = await fetch('https://api.github.com/repos/' + repository + path, {
            method,
            headers: {
                authorization: 'Bearer ' + process.env.GITHUB_TOKEN,
                accept: 'application/vnd.github+json',
                'content-type': 'application/json',
                'user-agent': 'splitx-uptime',
            },
            body: body ? JSON.stringify(body) : undefined,
        });
        if (!response.ok) throw new Error('GitHub answered HTTP ' + response.status + ' to ' + method + ' ' + path.split('?')[0]);
        return response.json();
    };
    try {
        const open = (await github('GET', '/issues?state=open&creator=' + encodeURIComponent('github-actions[bot]') + '&per_page=50'))
            .filter((issue) => !issue.pull_request);
        const plan = incidentAction(open, results);
        const runUrl = process.env.GITHUB_SERVER_URL + '/' + repository + '/actions/runs/' + process.env.GITHUB_RUN_ID;
        if (plan.action === 'open') {
            const issue = await github('POST', '/issues', {
                title: plan.title,
                body: summaryTable(results, at) + '\nFound by [this run](' + runUrl + ') of the production checks (`.github/workflows/uptime.yml`). '
                    + 'Each check was asked twice, 20 s apart. This issue closes itself when every check passes again.',
            });
            console.log('Opened incident #' + issue.number + '.');
        } else if (plan.action === 'close') {
            await github('POST', '/issues/' + plan.issue.number + '/comments', { body: recoveryComment(plan.issue, at, runUrl) });
            await github('PATCH', '/issues/' + plan.issue.number, { state: 'closed', state_reason: 'completed' });
            console.log('Closed incident #' + plan.issue.number + ': recovered.');
        } else if (plan.issue) {
            console.log('Incident #' + plan.issue.number + ' stays open.');
        }
    } catch (error) {
        // The checks' verdict still decides the run; the issue is a record of it.
        console.log('Could not update the incident issue: ' + error.message);
    }
}

process.exit(passed === results.length ? 0 : 1);
