-- Ending sessions: a password reset, or "sign out of all devices", raises an
-- account's tokenVersion, and a session issued with an older version is
-- refused (src/lib/auth.ts). Sessions issued before this column carry no
-- version and count as 0, the default, so nobody is signed out by it.
-- A constant default is stored once, not written into every row: instant.

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "tokenVersion" INTEGER NOT NULL DEFAULT 0;

