-- Rollback (Prisma has no down migrations): revert the app commit, make sure no
-- row has a null slug (give each a unique slug or delete it), then
--   ALTER TABLE "Event" DROP CONSTRAINT "Event_published_requires_slug";
--   ALTER TABLE "Event" ALTER COLUMN "slug" SET NOT NULL;
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261115000000_event_slug_optional';

-- Staff-only events (e.g. fundraisers) have no public page, so no slug. Nullable
-- column: metadata-only change, existing rows unaffected. The @unique index stays;
-- Postgres allows many NULLs in a unique index.
ALTER TABLE "Event" ALTER COLUMN "slug" DROP NOT NULL;

-- A published event is served at /e/<slug>, so it must have a slug. Enforced in the
-- DB to close the publish / clear-slug race. Safe to add: slug was NOT NULL until this
-- migration, so no existing row is published with a null slug.
ALTER TABLE "Event" ADD CONSTRAINT "Event_published_requires_slug" CHECK ("isPublished" = false OR "slug" IS NOT NULL);
