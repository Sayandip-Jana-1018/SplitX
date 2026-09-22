#!/usr/bin/env node
/**
 * Migrates the production database. Run by the "Production database" workflow
 * (.github/workflows/production-database.yml), after a reviewer approves the
 * run; it works anywhere Prisma can reach the database, which from GitHub's
 * runners it can (this laptop's network blocks port 5432).
 *
 *   node scripts/db-migrate.mjs           report: what the database has, what is pending,
 *                                         and, the first time, whether it matches 0_baseline
 *   node scripts/db-migrate.mjs --apply   also record 0_baseline (once), apply what is
 *                                         pending, and confirm the database now matches
 *                                         prisma/schema.prisma
 *
 * Needs DATABASE_URL, the database's direct address rather than its pooled one
 * (a migration holds an advisory lock, which a transaction-mode pooler can't),
 * and SHADOW_DATABASE_URL, an empty throwaway Postgres where Prisma replays
 * migrations to compare against. Neither is printed.
 *
 * Production was created with `prisma db push`, before there were migrations.
 * Recording that it holds 0_baseline is only safe if it holds exactly that, so
 * Prisma's own diff compares the two first, and any difference stops the run.
 *
 * Exit 0 when done, or when a report found nothing wrong; 1 when refused or failed.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, copyFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const apply = process.argv.includes('--apply');
const BASELINE = '0_baseline';

const { DATABASE_URL, SHADOW_DATABASE_URL } = process.env;
if (!DATABASE_URL || !SHADOW_DATABASE_URL) {
    console.error('Set DATABASE_URL (the database to migrate) and SHADOW_DATABASE_URL (an empty throwaway Postgres).');
    process.exit(1);
}
if (new URL(DATABASE_URL).hostname.includes('-pooler')) {
    console.error('DATABASE_URL is Neon\'s pooled address. Migrations need the direct one: the same address without "-pooler" in the host.');
    process.exit(1);
}

const summary = [];
const note = (line) => {
    console.log(line);
    summary.push(line);
};

/** Runs the Prisma CLI through node directly (no shell, no npx), with its output shown. */
function prisma(args) {
    const result = spawnSync(process.execPath, [join(root, 'node_modules', 'prisma', 'build', 'index.js'), ...args], {
        cwd: root,
        encoding: 'utf8',
        // The schema reads both; for a migration they are the same direct address.
        env: { ...process.env, DIRECT_URL: DATABASE_URL },
        maxBuffer: 16 * 1024 * 1024,
    });
    if (result.error) throw result.error;
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
    return { status: result.status, output };
}

function show(title, output) {
    console.log(`\n── ${title} ──\n${output || '(nothing printed)'}\n`);
}

/** Whether Prisma Migrate manages the database yet, and whether it has any tables at all. */
async function inspect() {
    const { PrismaClient } = await import('@prisma/client');
    const db = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
    try {
        const [row] = await db.$queryRawUnsafe(
            `SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS managed,
                    EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public') AS "hasTables"`
        );
        return { managed: row.managed, hasTables: row.hasTables };
    } finally {
        await db.$disconnect();
    }
}

/** Prisma's diff from the database to `target`: exit 0 = the same, 2 = different (the SQL is printed). */
function diffAgainst(targetArgs) {
    return prisma(['migrate', 'diff', '--from-schema-datasource', 'prisma/schema.prisma', ...targetArgs, '--script', '--exit-code']);
}

function baselineOnly() {
    const dir = mkdtempSync(join(tmpdir(), 'splitx-baseline-'));
    mkdirSync(join(dir, BASELINE));
    copyFileSync(join(root, 'prisma', 'migrations', BASELINE, 'migration.sql'), join(dir, BASELINE, 'migration.sql'));
    copyFileSync(join(root, 'prisma', 'migrations', 'migration_lock.toml'), join(dir, 'migration_lock.toml'));
    return dir;
}

function finish(code) {
    if (process.env.GITHUB_STEP_SUMMARY) {
        appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### ${apply ? 'Apply' : 'Report'}\n\n${summary.map((line) => `- ${line}`).join('\n')}\n`);
    }
    process.exit(code);
}

const before = await inspect();
const status = prisma(['migrate', 'status']);
show('prisma migrate status', status.output);

let needsBaseline = false;
if (before.managed) {
    note('The database is managed by Prisma Migrate.');
} else if (!before.hasTables) {
    note('The database is empty: every migration will be applied from the start.');
} else {
    // Created before migrations existed: it must hold exactly the baseline.
    const compared = diffAgainst(['--to-migrations', baselineOnly(), '--shadow-database-url', SHADOW_DATABASE_URL]);
    if (compared.status === 0) {
        needsBaseline = true;
        note(`The database predates migrations and holds exactly ${BASELINE} (Prisma's diff is empty).`);
    } else {
        show(`SQL that would turn the database into ${BASELINE}`, compared.output);
        note(compared.status === 2
            ? `**Refused:** the database differs from ${BASELINE} (the SQL above is the difference). It is not marked as migrated.`
            : '**Failed** to compare the database with the baseline (see the log).');
        finish(1);
    }
}

if (!apply) {
    const pending = diffAgainst(['--to-schema-datamodel', 'prisma/schema.prisma']);
    if (pending.status === 0) {
        note('The database already matches prisma/schema.prisma; applying would change nothing.');
    } else if (pending.status === 2) {
        show('What the pending migrations will change', pending.output);
        note('Applying will run the pending migrations listed above; nothing has been changed.');
    } else {
        show('prisma migrate diff', pending.output);
        note('**Failed** to compare the database with prisma/schema.prisma.');
        finish(1);
    }
    finish(0);
}

if (needsBaseline) {
    const resolved = prisma(['migrate', 'resolve', '--applied', BASELINE]);
    show(`prisma migrate resolve --applied ${BASELINE}`, resolved.output);
    if (resolved.status !== 0) {
        note(`**Failed** to record ${BASELINE}.`);
        finish(1);
    }
    note(`Recorded ${BASELINE} as applied; nothing in the database changed.`);
}

const deployed = prisma(['migrate', 'deploy']);
show('prisma migrate deploy', deployed.output);
if (deployed.status !== 0) {
    note('**Failed** to apply the pending migrations (see the log). A failed migration is recorded as failed and blocks the next run until it is resolved.');
    finish(1);
}
const applied = [...deployed.output.matchAll(/└─ (\d+_[\w]+)\//g)].map((match) => match[1]);
note(applied.length > 0 ? `Applied: ${applied.join(', ')}.` : 'No migration was pending.');

const after = diffAgainst(['--to-schema-datamodel', 'prisma/schema.prisma']);
if (after.status !== 0) {
    show('Difference left between the database and prisma/schema.prisma', after.output);
    note('**The database still differs from prisma/schema.prisma** after migrating (see the log).');
    finish(1);
}
note('The database now matches prisma/schema.prisma exactly (Prisma\'s diff is empty).');
finish(0);
