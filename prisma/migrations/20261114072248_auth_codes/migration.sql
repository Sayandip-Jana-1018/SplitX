-- Short-lived codes for the phone app's sign-in (docs/mobile/ROADMAP.md, Phase 2
-- step 4): emailed 6-digit codes and the website's Google/GitHub hand-off.
-- One new table and nothing else, so the website runs on either side of it.

-- CreateTable
CREATE TABLE "AuthCode" (
    "id" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "email" TEXT,
    "userId" TEXT,
    "codeHash" TEXT NOT NULL,
    "challenge" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AuthCode_codeHash_key" ON "AuthCode"("codeHash");

-- CreateIndex
CREATE INDEX "AuthCode_purpose_email_idx" ON "AuthCode"("purpose", "email");

-- AddForeignKey
ALTER TABLE "AuthCode" ADD CONSTRAINT "AuthCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
