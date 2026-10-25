
-- CreateEnum
CREATE TYPE "VenueBookingStatus" AS ENUM ('REQUESTED', 'CONFIRMED', 'CANCELLED');

-- CreateTable
CREATE TABLE "VenueUsage" (
    "id" SERIAL NOT NULL,
    "date" DATE NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "status" "VenueBookingStatus" NOT NULL DEFAULT 'CONFIRMED',
    "purpose" TEXT,
    "notes" TEXT,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VenueUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VenueUsageRequest" (
    "id" SERIAL NOT NULL,
    "month" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "sentTo" TEXT,
    "status" TEXT,
    "errorMessage" TEXT,
    "sentById" INTEGER,
    "reminderSentAt" TIMESTAMP(3),
    "reminderClaimedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VenueUsageRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VenueUsage_date_idx" ON "VenueUsage"("date");

-- CreateIndex
CREATE INDEX "VenueUsage_createdById_idx" ON "VenueUsage"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "VenueUsageRequest_month_key" ON "VenueUsageRequest"("month");

-- CreateIndex
CREATE INDEX "VenueUsageRequest_sentById_idx" ON "VenueUsageRequest"("sentById");

-- AddForeignKey
ALTER TABLE "VenueUsage" ADD CONSTRAINT "VenueUsage_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VenueUsageRequest" ADD CONSTRAINT "VenueUsageRequest_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

