-- A save that is retried (the network dropped after the server saved it) or
-- tapped twice carries the same Idempotency-Key, stored here as
-- "<userId>:<key>"; the unique index makes the second one find the first
-- instead of creating another expense, even when both arrive at once.
-- Existing rows keep NULL, which a unique index allows any number of.

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "idempotencyKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_idempotencyKey_key" ON "Transaction"("idempotencyKey");

