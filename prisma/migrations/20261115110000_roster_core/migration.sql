-- CreateEnum
CREATE TYPE "RosterServiceKind" AS ENUM ('SUNDAY', 'ADHOC');

-- CreateEnum
CREATE TYPE "RosterAssignmentStatus" AS ENUM ('PENDING', 'CONFIRMED', 'DECLINED');

-- CreateTable
CREATE TABLE "RosterRole" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "groupId" INTEGER NOT NULL,
    "defaultCount" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RosterRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RosterService" (
    "id" SERIAL NOT NULL,
    "kind" "RosterServiceKind" NOT NULL,
    "title" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "location" TEXT NOT NULL DEFAULT '',
    "weeklyKey" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RosterService_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RosterSlot" (
    "id" SERIAL NOT NULL,
    "serviceId" INTEGER NOT NULL,
    "roleId" INTEGER NOT NULL,
    "needed" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RosterSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RosterAssignment" (
    "id" SERIAL NOT NULL,
    "slotId" INTEGER NOT NULL,
    "serviceId" INTEGER NOT NULL,
    "personId" INTEGER NOT NULL,
    "status" "RosterAssignmentStatus" NOT NULL DEFAULT 'PENDING',
    "respondedAt" TIMESTAMP(3),
    "reminderClaimedAt" TIMESTAMP(3),
    "reminderSentAt" TIMESTAMP(3),
    "assignedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RosterAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonUnavailability" (
    "id" SERIAL NOT NULL,
    "personId" INTEGER NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonUnavailability_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RosterRole_name_key" ON "RosterRole"("name");

-- CreateIndex
CREATE INDEX "RosterRole_groupId_idx" ON "RosterRole"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "RosterService_weeklyKey_key" ON "RosterService"("weeklyKey");

-- CreateIndex
CREATE INDEX "RosterService_date_idx" ON "RosterService"("date");

-- CreateIndex
CREATE INDEX "RosterSlot_roleId_idx" ON "RosterSlot"("roleId");

-- CreateIndex
CREATE UNIQUE INDEX "RosterSlot_serviceId_roleId_key" ON "RosterSlot"("serviceId", "roleId");

-- CreateIndex
CREATE UNIQUE INDEX "RosterSlot_id_serviceId_key" ON "RosterSlot"("id", "serviceId");

-- CreateIndex
CREATE INDEX "RosterAssignment_slotId_idx" ON "RosterAssignment"("slotId");

-- CreateIndex
CREATE INDEX "RosterAssignment_personId_idx" ON "RosterAssignment"("personId");

-- CreateIndex
CREATE INDEX "RosterAssignment_status_reminderSentAt_idx" ON "RosterAssignment"("status", "reminderSentAt");

-- CreateIndex
CREATE UNIQUE INDEX "RosterAssignment_serviceId_personId_key" ON "RosterAssignment"("serviceId", "personId");

-- CreateIndex
CREATE INDEX "PersonUnavailability_personId_endDate_idx" ON "PersonUnavailability"("personId", "endDate");

-- AddForeignKey
ALTER TABLE "RosterRole" ADD CONSTRAINT "RosterRole_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RosterSlot" ADD CONSTRAINT "RosterSlot_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "RosterService"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RosterSlot" ADD CONSTRAINT "RosterSlot_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "RosterRole"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RosterAssignment" ADD CONSTRAINT "RosterAssignment_slotId_serviceId_fkey" FOREIGN KEY ("slotId", "serviceId") REFERENCES "RosterSlot"("id", "serviceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RosterAssignment" ADD CONSTRAINT "RosterAssignment_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonUnavailability" ADD CONSTRAINT "PersonUnavailability_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Invariants the app relies on, enforced in the DB too (Prisma does not model CHECKs).
ALTER TABLE "RosterRole" ADD CONSTRAINT "RosterRole_defaultCount_check" CHECK ("defaultCount" >= 1);
ALTER TABLE "RosterSlot" ADD CONSTRAINT "RosterSlot_needed_check" CHECK ("needed" >= 1);
ALTER TABLE "RosterService" ADD CONSTRAINT "RosterService_times_check" CHECK ("endsAt" > "startsAt");
ALTER TABLE "RosterService" ADD CONSTRAINT "RosterService_weeklyKey_check" CHECK (("kind" = 'SUNDAY' AND "weeklyKey" = "startsAt") OR ("kind" = 'ADHOC' AND "weeklyKey" IS NULL));
ALTER TABLE "PersonUnavailability" ADD CONSTRAINT "PersonUnavailability_range_check" CHECK ("endDate" >= "startDate");
