-- CreateEnum
CREATE TYPE "ClearanceType" AS ENUM ('WWCC', 'SAFE_MINISTRY');

-- CreateTable
CREATE TABLE "PersonClearance" (
    "id" TEXT NOT NULL,
    "personId" INTEGER NOT NULL,
    "type" "ClearanceType" NOT NULL,
    "number" TEXT,
    "expiresAt" DATE,
    "document" BYTEA,
    "documentName" TEXT,
    "documentType" TEXT,
    "documentSize" INTEGER,
    "verifiedAt" TIMESTAMP(3),
    "verifiedById" INTEGER,
    "verificationNote" TEXT,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonClearance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PersonClearance_type_expiresAt_idx" ON "PersonClearance"("type", "expiresAt");

-- CreateIndex
CREATE INDEX "PersonClearance_verifiedById_idx" ON "PersonClearance"("verifiedById");

-- CreateIndex
CREATE UNIQUE INDEX "PersonClearance_personId_type_key" ON "PersonClearance"("personId", "type");

-- AddForeignKey
ALTER TABLE "PersonClearance" ADD CONSTRAINT "PersonClearance_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonClearance" ADD CONSTRAINT "PersonClearance_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

