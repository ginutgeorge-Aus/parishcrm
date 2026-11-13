-- Staff-only events (e.g. fundraisers) have no public page, so no slug. Nullable
-- column: metadata-only change, existing rows unaffected. The @unique index stays;
-- Postgres allows many NULLs in a unique index.
ALTER TABLE "Event" ALTER COLUMN "slug" DROP NOT NULL;
