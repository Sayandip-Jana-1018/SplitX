#!/usr/bin/env node
/**
 * Checks the money in a SplitX database against the rules the app now keeps
 * (D-063, D-064), and reports how many records break each one. Read only: it
 * runs SELECTs and nothing else, and prints counts, never names, addresses or
 * record IDs. Repairs are separate and approved one at a time.
 *
 *   node --env-file=.env scripts/ledger-audit.mjs [--https] [--json]
 *
 * Which database: MIGRATION_DATABASE_URL if set, otherwise DATABASE_URL (the
 * local .env points DATABASE_URL at the Compose Postgres).
 * --https: reach Neon over port 443, for networks that block 5432 (see
 * scripts/migrate-avatars.mjs for the protocol).
 * --json: the report as JSON, for docs/evidence.
 *
 * Exit code 0 when every check finds nothing, 1 when any finds something,
 * 2 when the audit could not run.
 */

const overHttps = process.argv.includes('--https');
const asJson = process.argv.includes('--json');

const connectionString = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
if (!connectionString) {
    console.error('No MIGRATION_DATABASE_URL or DATABASE_URL. Run with --env-file=.env');
    process.exit(2);
}

async function openDatabase() {
    if (overHttps) {
        const host = new URL(connectionString).hostname;
        const endpoint = 'https://api.' + host.slice(host.indexOf('.') + 1) + '/sql';
        return {
            label: 'SQL over HTTPS',
            // Sent as a one-statement batch, which Neon runs in a READ ONLY
            // transaction: the database itself refuses any write.
            query: async (query) => {
                const response = await fetch(endpoint, {
                    method: 'POST',
                    headers: {
                        'content-type': 'application/json',
                        'Neon-Connection-String': connectionString,
                        'Neon-Raw-Text-Output': 'true',
                        'Neon-Array-Mode': 'false',
                        'Neon-Batch-Read-Only': 'true',
                    },
                    body: JSON.stringify({ queries: [{ query, params: [] }] }),
                });
                const body = await response.json();
                if (!response.ok) throw new Error('The database refused the query: ' + (body.message ?? 'HTTP ' + response.status));
                return body.results[0].rows;
            },
            close: async () => {},
        };
    }
    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient({ datasources: { db: { url: connectionString } } });
    return {
        label: 'Postgres protocol',
        query: async (query) => prisma.$transaction(async (tx) => {
            await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
            return tx.$queryRawUnsafe(query);
        }),
        close: () => prisma.$disconnect(),
    };
}

// Shared building blocks: live groups, their trips, live expenses, current members.
const LIVE = `
    live_groups AS (SELECT id, "ownerId" FROM "Group" WHERE "deletedAt" IS NULL),
    live_trips AS (SELECT t.id, t."groupId" FROM "Trip" t JOIN live_groups g ON g.id = t."groupId"),
    live_txns AS (
        SELECT x.id, x."payerId", x.amount, lt."groupId"
        FROM "Transaction" x JOIN live_trips lt ON lt.id = x."tripId"
        WHERE x."deletedAt" IS NULL
    ),
    members AS (
        SELECT "groupId", "userId" FROM "GroupMember"
        UNION SELECT id, "ownerId" FROM live_groups
    )`;

const BALANCES = `${LIVE},
    completed AS (
        SELECT st."fromId", st."toId", st.amount, lt."groupId"
        FROM "Settlement" st JOIN live_trips lt ON lt.id = st."tripId"
        WHERE st."deletedAt" IS NULL AND st.status IN ('completed', 'confirmed')
    ),
    deltas AS (
        SELECT "groupId", "payerId" AS "userId", amount::bigint AS delta FROM live_txns
        UNION ALL SELECT lt."groupId", s."userId", -s.amount::bigint FROM "SplitItem" s JOIN live_txns lt ON lt.id = s."transactionId"
        UNION ALL SELECT "groupId", "fromId", amount::bigint FROM completed
        UNION ALL SELECT "groupId", "toId", -amount::bigint FROM completed
    ),
    balances AS (SELECT "groupId", "userId", SUM(delta) AS balance FROM deltas GROUP BY 1, 2)`;

const CHECKS = [
    {
        key: 'shares_not_adding_up',
        rule: 'An expense’s shares add up to its amount, to the paisa',
        sql: `WITH ${LIVE.trim()},
            sums AS (SELECT lt.id, lt.amount, COALESCE(SUM(s.amount), 0) AS shares
                     FROM live_txns lt LEFT JOIN "SplitItem" s ON s."transactionId" = lt.id GROUP BY lt.id, lt.amount)
            SELECT COUNT(*) AS count, COALESCE(SUM(ABS(amount - shares)), 0) AS paise FROM sums WHERE amount <> shares`,
    },
    {
        key: 'expenses_without_shares',
        rule: 'Every expense is shared by someone',
        sql: `WITH ${LIVE.trim()}
            SELECT COUNT(*) AS count FROM live_txns lt
            WHERE NOT EXISTS (SELECT 1 FROM "SplitItem" s WHERE s."transactionId" = lt.id)`,
    },
    {
        key: 'shares_of_non_members',
        rule: 'Shares of live expenses belong to current members (the old member removal moved them)',
        sql: `WITH ${LIVE.trim()}
            SELECT COUNT(*) AS count, COUNT(DISTINCT lt."groupId") AS groups
            FROM "SplitItem" s JOIN live_txns lt ON lt.id = s."transactionId"
            WHERE NOT EXISTS (SELECT 1 FROM members m WHERE m."groupId" = lt."groupId" AND m."userId" = s."userId")`,
    },
    {
        key: 'former_members_with_balance',
        rule: 'Nobody leaves a group while they owe or are owed money',
        sql: `WITH ${BALANCES.trim()}
            SELECT COUNT(*) AS count, COUNT(DISTINCT b."groupId") AS groups, COALESCE(SUM(ABS(b.balance)), 0) AS paise
            FROM balances b
            WHERE b.balance <> 0
              AND NOT EXISTS (SELECT 1 FROM members m WHERE m."groupId" = b."groupId" AND m."userId" = b."userId")`,
    },
    {
        key: 'groups_not_netting_to_zero',
        rule: 'Every group’s balances add up to zero',
        sql: `WITH ${BALANCES.trim()}
            SELECT COUNT(*) AS count FROM (SELECT "groupId" FROM balances GROUP BY 1 HAVING SUM(balance) <> 0) g`,
    },
    {
        key: 'expense_amounts_out_of_range',
        rule: 'An expense is between ₹0.01 and ₹10,00,000',
        sql: `WITH ${LIVE.trim()}
            SELECT COUNT(*) AS count FROM live_txns WHERE amount <= 0 OR amount > 100000000`,
    },
    {
        key: 'negative_shares',
        rule: 'No share is negative',
        sql: `WITH ${LIVE.trim()}
            SELECT COUNT(*) AS count FROM "SplitItem" s JOIN live_txns lt ON lt.id = s."transactionId" WHERE s.amount < 0`,
    },
    {
        key: 'settlements_not_positive',
        rule: 'A settlement moves a positive amount',
        sql: `SELECT COUNT(*) AS count FROM "Settlement" WHERE "deletedAt" IS NULL AND amount <= 0`,
    },
    {
        key: 'settlements_to_self',
        rule: 'Nobody settles with themselves',
        sql: `SELECT COUNT(*) AS count FROM "Settlement" WHERE "deletedAt" IS NULL AND "fromId" = "toId"`,
    },
    {
        key: 'settlements_unknown_status',
        rule: 'A settlement is in a state the transition table knows',
        sql: `SELECT COUNT(*) AS count FROM "Settlement"
              WHERE "deletedAt" IS NULL
                AND status NOT IN ('pending', 'initiated', 'paid_pending', 'completed', 'confirmed', 'cancelled')`,
    },
    {
        key: 'settlements_waiting_in_deleted_groups',
        rule: 'A deleted group has no payment still waiting',
        sql: `SELECT COUNT(*) AS count FROM "Settlement" st
              JOIN "Trip" t ON t.id = st."tripId" JOIN "Group" g ON g.id = t."groupId"
              WHERE g."deletedAt" IS NOT NULL AND st."deletedAt" IS NULL
                AND st.status IN ('pending', 'initiated', 'paid_pending')`,
    },
    {
        key: 'settlements_waiting_over_30_days',
        rule: 'Payments don’t sit waiting for more than 30 days (informational)',
        informational: true,
        sql: `SELECT COUNT(*) AS count FROM "Settlement"
              WHERE "deletedAt" IS NULL AND status IN ('pending', 'initiated', 'paid_pending')
                AND "updatedAt" < NOW() - INTERVAL '30 days'`,
    },
    {
        key: 'emails_differing_only_by_case',
        rule: 'One account per address, whatever its case',
        sql: `SELECT COUNT(*) AS count FROM (
                SELECT LOWER(email) FROM "User" WHERE email IS NOT NULL GROUP BY 1 HAVING COUNT(*) > 1
              ) d`,
    },
];

const db = await openDatabase();
let report;
try {
    const [where] = await db.query('SELECT current_database() AS db');
    // What was checked, so a report of zeros can't be an empty database's.
    const [scope] = await db.query(`WITH ${LIVE.trim()}
        SELECT (SELECT COUNT(*) FROM live_groups) AS groups,
               (SELECT COUNT(*) FROM live_txns) AS expenses,
               (SELECT COUNT(*) FROM "SplitItem" s JOIN live_txns lt ON lt.id = s."transactionId") AS shares,
               (SELECT COUNT(*) FROM "Settlement" WHERE "deletedAt" IS NULL) AS settlements,
               (SELECT COUNT(*) FROM "User") AS accounts`);
    const results = [];
    for (const check of CHECKS) {
        const [row] = await db.query(check.sql);
        results.push({
            key: check.key,
            rule: check.rule,
            informational: Boolean(check.informational),
            ...Object.fromEntries(Object.entries(row).map(([name, value]) => [name, Number(value)])),
        });
    }
    report = {
        database: where.db,
        via: db.label,
        checkedAt: new Date().toISOString(),
        scope: Object.fromEntries(Object.entries(scope).map(([name, value]) => [name, Number(value)])),
        results,
    };
} catch (error) {
    console.error('The audit could not run: ' + (error instanceof Error ? error.message : String(error)));
    process.exit(2);
} finally {
    await db.close();
}

const problems = report.results.filter((result) => result.count > 0 && !result.informational);
if (asJson) {
    console.log(JSON.stringify(report, null, 2));
} else {
    console.log(`Ledger audit of database "${report.database}" (${report.via}), read only, ${report.checkedAt}`);
    console.log(`Checked ${Object.entries(report.scope).map(([name, value]) => `${value} ${name}`).join(', ')}\n`);
    for (const result of report.results) {
        const extra = Object.entries(result)
            .filter(([name]) => !['key', 'rule', 'informational', 'count'].includes(name))
            .map(([name, value]) => (name === 'paise' ? `₹${(value / 100).toLocaleString('en-IN')}` : `${value} ${name}`))
            .join(', ');
        const mark = result.count === 0 ? 'ok  ' : result.informational ? 'info' : 'FAIL';
        console.log(`${mark}  ${String(result.count).padStart(5)}  ${result.rule}${extra ? `  (${extra})` : ''}`);
    }
    console.log(`\n${problems.length === 0 ? 'No rule is broken.' : `${problems.length} rule(s) broken. Nothing was changed.`}`);
}
process.exit(problems.length === 0 ? 0 : 1);
