-- The restore drill's fingerprint of one database (.github/workflows/restore-drill.yml).
-- Run against production and against its restored copy; the two outputs must be equal.
-- Read only: everything runs in one READ ONLY transaction, so the database itself
-- refuses any write. The output is hashes and yes/no answers, never data: the
-- workflow compares them on the runner and prints only "same" or "different".
--
--   psql "$URL" -X -At -v ON_ERROR_STOP=1 -f scripts/restore-drill.sql
--
-- Lines:  table|<name>|<md5 of every row, in a fixed order>
--         balances|<md5 of every member's balance in every group>
--         unbalanced-groups|<how many groups don't net to zero (must be 0)>

BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;

-- Every table in public, whole: each row as text, sorted, hashed. One query per table,
-- built here and run by psql's \gexec.
SELECT format(
    'SELECT %L || ''|'' || md5(coalesce(string_agg(t::text, E''\n'' ORDER BY t::text), '''')) FROM %I.%I t',
    'table|' || tablename, schemaname, tablename
)
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename
\gexec

-- Every member's balance in every group, by the app's rule (src/lib/ledger.ts):
-- live expenses (the payer is owed the amount, each share owes its part) and
-- completed settlements (the payer's balance rises, the receiver's falls).
WITH live_expense AS (
    SELECT t.id, t.amount, t."payerId", tr."groupId"
    FROM "Transaction" t JOIN "Trip" tr ON tr.id = t."tripId"
    WHERE t."deletedAt" IS NULL
),
done_settlement AS (
    SELECT s."fromId", s."toId", s.amount, tr."groupId"
    FROM "Settlement" s JOIN "Trip" tr ON tr.id = s."tripId"
    WHERE s."deletedAt" IS NULL AND s.status IN ('completed', 'confirmed')
),
moves AS (
    SELECT "groupId" AS group_id, "payerId" AS user_id, amount AS delta FROM live_expense
    UNION ALL SELECT e."groupId", si."userId", -si.amount FROM "SplitItem" si JOIN live_expense e ON e.id = si."transactionId"
    UNION ALL SELECT "groupId", "fromId", amount FROM done_settlement
    UNION ALL SELECT "groupId", "toId", -amount FROM done_settlement
),
balance AS (
    SELECT group_id, user_id, sum(delta) AS paise FROM moves GROUP BY group_id, user_id
)
SELECT 'balances|' || md5(coalesce(string_agg(group_id || ':' || user_id || '=' || paise, ',' ORDER BY group_id, user_id), ''))
FROM balance;

WITH balance AS (
    SELECT tr."groupId" AS group_id, sum(t.amount) - coalesce(sum(shares.owed), 0) AS net
    FROM "Transaction" t
    JOIN "Trip" tr ON tr.id = t."tripId"
    LEFT JOIN (SELECT "transactionId", sum(amount) AS owed FROM "SplitItem" GROUP BY "transactionId") shares ON shares."transactionId" = t.id
    WHERE t."deletedAt" IS NULL
    GROUP BY tr."groupId"
)
SELECT 'unbalanced-groups|' || count(*) FROM balance WHERE net <> 0;

COMMIT;
