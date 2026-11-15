-- Pastoral care (#305, #612): follow-up tasks and prayer requests.

-- CreateEnum
CREATE TYPE "FollowUpStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PrayerRequestSource" AS ENUM ('STAFF', 'PUBLIC_FORM');

-- CreateEnum
CREATE TYPE "PrayerRequestStatus" AS ENUM ('ACTIVE', 'ANSWERED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "FollowUpTask" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "personId" INTEGER,
    "familyId" INTEGER,
    "assigneeId" INTEGER,
    "dueDate" DATE,
    "status" "FollowUpStatus" NOT NULL DEFAULT 'OPEN',
    "completedAt" TIMESTAMP(3),
    "completedById" INTEGER,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FollowUpTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrayerRequest" (
    "id" SERIAL NOT NULL,
    "source" "PrayerRequestSource" NOT NULL DEFAULT 'STAFF',
    "status" "PrayerRequestStatus" NOT NULL DEFAULT 'ACTIVE',
    "request" TEXT NOT NULL,
    "requesterName" TEXT,
    "requesterEmail" TEXT,
    "requesterPhone" TEXT,
    "personId" INTEGER,
    "shareConsent" BOOLEAN NOT NULL DEFAULT false,
    "shareConsentAt" TIMESTAMP(3),
    "shareConsentById" INTEGER,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrayerRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FollowUpTask_assigneeId_status_dueDate_idx" ON "FollowUpTask"("assigneeId", "status", "dueDate");

-- CreateIndex
CREATE INDEX "FollowUpTask_status_dueDate_idx" ON "FollowUpTask"("status", "dueDate");

-- CreateIndex
CREATE INDEX "FollowUpTask_personId_idx" ON "FollowUpTask"("personId");

-- CreateIndex
CREATE INDEX "FollowUpTask_familyId_idx" ON "FollowUpTask"("familyId");

-- CreateIndex
CREATE INDEX "PrayerRequest_status_shareConsent_createdAt_idx" ON "PrayerRequest"("status", "shareConsent", "createdAt");

-- CreateIndex
CREATE INDEX "PrayerRequest_personId_idx" ON "PrayerRequest"("personId");

-- AddForeignKey
ALTER TABLE "FollowUpTask" ADD CONSTRAINT "FollowUpTask_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUpTask" ADD CONSTRAINT "FollowUpTask_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUpTask" ADD CONSTRAINT "FollowUpTask_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrayerRequest" ADD CONSTRAINT "PrayerRequest_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A task targets exactly one person OR one family. Prisma cannot model CHECK
-- constraints, so this lives only in migration SQL (see FollowUpTask).
ALTER TABLE "FollowUpTask" ADD CONSTRAINT "FollowUpTask_one_target" CHECK (("personId" IS NULL) <> ("familyId" IS NULL));
