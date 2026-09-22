#!/usr/bin/env node
/**
 * Builds k8s/components/postgres/schema.sql from prisma/migrations, for the
 * in-cluster Postgres.
 *
 * The application image carries no npm and no Prisma CLI — that is the point of
 * a 81 MB runtime — so a pod cannot run `prisma migrate deploy`. The file this
 * writes does what that command does, in psql, which the Postgres image has:
 * each migration the database doesn't have yet is applied in its own
 * transaction and recorded in _prisma_migrations, with the checksum Prisma
 * records. It is safe to run on every deploy, a database it built is one Prisma
 * reads as up to date, and a migration added later reaches a cluster whose
 * database already exists.
 *
 *   node scripts/db-schema.mjs           rewrite k8s/components/postgres/schema.sql
 *   node scripts/db-schema.mjs --check   fail if the committed file is stale
 *
 * --check runs in CI. Whether the migrations themselves match
 * prisma/schema.prisma takes a database to replay them on, so the CI database
 * job checks that, and also builds one database with this file and one with
 * Prisma and compares them.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = join(root, 'prisma', 'migrations');
const target = join(root, 'k8s', 'components', 'postgres', 'schema.sql');

// Prisma applies migrations in the order of their directory names. A
// timestamp prefix keeps that order the order they were written in; "10_x"
// would sort before "2_x".
const MIGRATION_NAME = /^(0_baseline|\d{14}_[a-z0-9_]+)$/;

// Prisma's own definition of the table (prisma-engines, Postgres flavour).
const MIGRATIONS_TABLE = `CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    "id"                    VARCHAR(36) PRIMARY KEY NOT NULL,
    "checksum"              VARCHAR(64) NOT NULL,
    "finished_at"           TIMESTAMPTZ,
    "migration_name"        VARCHAR(255) NOT NULL,
    "logs"                  TEXT,
    "rolled_back_at"        TIMESTAMPTZ,
    "started_at"            TIMESTAMPTZ NOT NULL DEFAULT now(),
    "applied_steps_count"   INTEGER NOT NULL DEFAULT 0
);`;

function readMigrations() {
    const names = readdirSync(migrationsDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
    if (names[0] !== '0_baseline') throw new Error('prisma/migrations must start with 0_baseline');

    return names.map((name) => {
        if (!MIGRATION_NAME.test(name)) {
            throw new Error(`prisma/migrations/${name}: name it <yyyymmddhhmmss>_<what_it_does>, as prisma migrate dev does`);
        }
        const file = join(migrationsDir, name, 'migration.sql');
        if (!existsSync(file)) throw new Error(`prisma/migrations/${name} has no migration.sql`);
        // Line endings are normalised so the output, and the checksum, are the
        // same on Windows and Linux; .gitattributes checks the files out as LF,
        // which is also what Prisma hashes on the machines that run it.
        const sql = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
        if (/^\s*\\/m.test(sql)) throw new Error(`prisma/migrations/${name}: a line starting with a backslash would be read by psql as a command`);
        return { name, sql, checksum: createHash('sha256').update(sql).digest('hex') };
    });
}

const record = (migration) => `INSERT INTO "_prisma_migrations" ("id", "checksum", "finished_at", "migration_name", "started_at", "applied_steps_count")
VALUES (gen_random_uuid()::text, '${migration.checksum}', now(), '${migration.name}', now(), 1);`;

function generate() {
    const migrations = readMigrations();
    const [baseline] = migrations;

    const blocks = migrations.map((migration) => `-- ─── ${migration.name} ${'─'.repeat(Math.max(3, 66 - migration.name.length))}
SELECT NOT EXISTS (
    SELECT 1 FROM "_prisma_migrations"
    WHERE "migration_name" = '${migration.name}' AND "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL
) AS pending \\gset
\\if :pending
\\echo 'applying ${migration.name}'
BEGIN;

${migration.sql.trim()}

${record(migration)}
COMMIT;
\\endif`);

    return `-- Generated from prisma/migrations by scripts/db-schema.mjs — do not edit.
-- Regenerate with: npm run db:schema
--
-- Run by the schema-init Job in k8s/components/postgres, with psql from the
-- Postgres image: \\gset and \\if below are psql commands, not SQL. Each
-- migration the database doesn't have yet is applied in its own transaction
-- and recorded in _prisma_migrations the way \`prisma migrate deploy\` records
-- it, so this runs on every deploy and only ever adds what is missing.
-- Neon (behind Vercel and EKS) is migrated by Prisma itself, from the
-- "Production database" workflow.

\\set ON_ERROR_STOP on
-- The file is UTF-8 (a default in the schema is an emoji); say so, as pg_dump
-- does, rather than rely on the encoding of the machine running psql.
SET client_encoding = 'UTF8';
SET client_min_messages TO warning;

-- A database this file built before it recorded migrations holds exactly
-- ${baseline.name}: record that, instead of creating tables that already exist.
SELECT to_regclass('public._prisma_migrations') IS NULL
   AND to_regclass('public."User"') IS NOT NULL AS built_before_migrations \\gset

${MIGRATIONS_TABLE}

\\if :built_before_migrations
${record(baseline)}
\\endif

${blocks.join('\n\n')}
`;
}

const generated = generate();

if (process.argv.includes('--check')) {
    let current = '';
    try {
        current = readFileSync(target, 'utf8').replace(/\r\n/g, '\n');
    } catch {
        console.error(`Missing ${target}. Run: npm run db:schema`);
        process.exit(1);
    }
    if (current !== generated) {
        console.error('k8s/components/postgres/schema.sql is out of date with prisma/migrations.');
        console.error('Run: npm run db:schema');
        process.exit(1);
    }
    console.log('schema.sql matches prisma/migrations');
} else {
    writeFileSync(target, generated);
    const migrations = (generated.match(/^\\echo 'applying /gm) || []).length;
    const tables = (generated.match(/^CREATE TABLE "/gm) || []).length;
    console.log(`Wrote ${target}: ${migrations} migrations, ${tables} tables.`);
}
