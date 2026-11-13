-- Staff-only events (e.g. fundraisers) have no public page, so no slug. Nullable
-- column: metadata-only change, existing rows unaffected. The @unique index stays;
-- Postgres allows many NULLs in a unique index.
ALTER TABLE "Event" ALTER COLUMN "slug" DROP NOT NULL;

-- A published event is served at /e/<slug>, so it must have a slug. Enforced in the
-- DB to close the publish / clear-slug race. Safe to add: slug was NOT NULL until this
-- migration, so no existing row is published with a null slug.
ALTER TABLE "Event" ADD CONSTRAINT "Event_published_requires_slug" CHECK ("isPublished" = false OR "slug" IS NOT NULL);
