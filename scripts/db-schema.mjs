#!/usr/bin/env node
/**
 * Turns prisma/schema.prisma into plain SQL for the in-cluster Postgres.
 *
 * The application image carries no npm and no Prisma CLI — that is the point of
 * a 81 MB runtime — so a pod cannot run `prisma db push`. The schema is
 * generated here, committed, and applied by a Job that runs `psql` from the
 * Postgres image itself.
 *
 *   node scripts/db-schema.mjs           rewrite k8s/components/postgres/schema.sql
 *   node scripts/db-schema.mjs --check   fail if the committed SQL is stale
 *
 * The --check mode runs in CI: a model added to schema.prisma without
 * regenerating would otherwise reach the cluster as a missing table.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'k8s', 'components', 'postgres', 'schema.sql');

const HEADER = `-- Generated from prisma/schema.prisma by scripts/db-schema.mjs — do not edit.
-- Regenerate with: npm run db:schema
--
-- Applied by the schema-init Job in k8s/components/postgres. Neon (the managed
-- database behind Vercel and EKS) is still managed with Prisma directly; this
-- file exists so the local cluster can stand up its own database with no npm,
-- no network and no Prisma CLI in any running container.
`;

function generate() {
    // The CLI is called through node directly rather than npx: Node refuses to
    // spawn a .cmd without a shell on Windows, and this needs no shell at all.
    const cli = join(root, 'node_modules', 'prisma', 'build', 'index.js');
    const sql = execFileSync(
        process.execPath,
        [cli, 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', 'prisma/schema.prisma', '--script'],
        { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
    );
    // Prisma emits CRLF on Windows; the file has to be byte-identical wherever
    // it is generated, or --check would fail for everyone on the other OS.
    return HEADER + '\n' + sql.replace(/\r\n/g, '\n').trimEnd() + '\n';
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
        console.error('k8s/components/postgres/schema.sql is out of date with prisma/schema.prisma.');
        console.error('Run: npm run db:schema');
        process.exit(1);
    }
    console.log('schema.sql matches prisma/schema.prisma');
} else {
    writeFileSync(target, generated);
    const tables = (generated.match(/^CREATE TABLE /gm) || []).length;
    const indexes = (generated.match(/^CREATE (UNIQUE )?INDEX /gm) || []).length;
    console.log(`Wrote ${target}: ${tables} tables, ${indexes} indexes.`);
}
