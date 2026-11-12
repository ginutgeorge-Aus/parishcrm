-- What a SUCCESS invoice request listed (#549): row count and CONFIRMED hours, so the job's notices-only retry
-- rebuilds its notice from the send itself, not from the current rows. Additive and nullable: safe on a live table.
ALTER TABLE "VenueUsageRequest" ADD COLUMN "sentRowCount" INTEGER,
ADD COLUMN "sentHours" DECIMAL(7,2);
