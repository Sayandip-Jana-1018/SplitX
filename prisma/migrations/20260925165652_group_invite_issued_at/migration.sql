-- A group's invite link works for 7 days after its code is made (D-112).
-- Groups that exist now count their code as made now, so every link already
-- shared keeps working for 7 more days. CURRENT_TIMESTAMP is read once, for
-- the whole statement, and a default that isn't volatile is stored once, not
-- written into every row: instant.

-- AlterTable
ALTER TABLE "Group" ADD COLUMN     "inviteCodeIssuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
