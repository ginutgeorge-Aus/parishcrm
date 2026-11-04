-- Stale-send marker (#536): set when the month's bookings changed while a SUCCESS invoice request went out,
-- so the job's notices-only retry no longer depends on the audit row. Additive and nullable: safe on a live table.
ALTER TABLE "VenueUsageRequest" ADD COLUMN "staleAt" TIMESTAMP(3);
