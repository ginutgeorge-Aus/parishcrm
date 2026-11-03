-- In-flight marker for venue invoice request sends (#509 #512): set just before the email goes,
-- cleared when the outcome is recorded. Additive and nullable: safe on a live table.
ALTER TABLE "VenueUsageRequest" ADD COLUMN "sendingAt" TIMESTAMP(3);
