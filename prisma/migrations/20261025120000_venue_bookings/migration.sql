-- AlterTable
ALTER TABLE "VenueUsage" ADD COLUMN "bookingRequestedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "VenueUsageRequest" ADD COLUMN "approvedAt" TIMESTAMP(3),
ADD COLUMN "approvedById" INTEGER,
ADD COLUMN "autoSent" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "VenueUsageRequest_approvedById_idx" ON "VenueUsageRequest"("approvedById");

-- AddForeignKey
ALTER TABLE "VenueUsageRequest" ADD CONSTRAINT "VenueUsageRequest_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
