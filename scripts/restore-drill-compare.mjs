#!/usr/bin/env node
/**
 * The restore drill's last step (.github/workflows/restore-drill.yml): reads the
 * three fingerprints, prints the verdict (table names and same or different,
 * never data), writes the job summary, and fails the job unless the copy is
 * production, whole.
 *
 *   node scripts/restore-drill-compare.mjs <before.txt> <after.txt> <restored.txt>
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { drillSummary, judgeDrill } from './lib/restoreDrill.mjs';

const [beforePath, afterPath, restoredPath] = process.argv.slice(2);
if (!restoredPath) {
    console.error('usage: node scripts/restore-drill-compare.mjs <before.txt> <after.txt> <restored.txt>');
    process.exit(2);
}

const result = judgeDrill(readFileSync(beforePath, 'utf8'), readFileSync(afterPath, 'utf8'), readFileSync(restoredPath, 'utf8'));
const summary = drillSummary(result, new Date().toISOString().replace(/\.\d+Z$/, 'Z'));
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
process.exit(result.ok ? 0 : 1);
