-- OSS-39: HMAC blind index over Family.suburb so the families suburb filter is
-- an indexed equality lookup instead of a bounded decrypt scan. Nullable, no
-- default: existing rows are filled by `npx tsx scripts/backfill-suburb-hash.ts`
-- (the HMAC key lives in the app env, so SQL cannot compute it). Until then the
-- families page still matches unhashed rows by decrypting them.
--
-- Rollback (Prisma has no down migrations): revert the app commit, then
--   DROP INDEX "Family_suburbHash_idx";
--   ALTER TABLE "Family" DROP COLUMN "suburbHash";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261113100000_family_suburb_hash';
-- Dropping the column loses only derived data (rebuildable from suburb).

-- AlterTable
ALTER TABLE "Family" ADD COLUMN "suburbHash" TEXT;

-- CreateIndex
CREATE INDEX "Family_suburbHash_idx" ON "Family"("suburbHash");
