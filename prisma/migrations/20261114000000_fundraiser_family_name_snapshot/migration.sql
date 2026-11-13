-- #650: keep a family's name on its fundraiser entries when the family link is
-- dropped (past-retention family delete, or a family merge that cannot fold an
-- entry into the target family's entry). Nullable column, no default: a
-- metadata-only change, no table rewrite, existing rows unaffected.
--
-- Rollback (down):
--   UPDATE "FundraiserEntry" SET "outsideName" = "familyNameSnapshot"
--     WHERE "familyId" IS NULL AND "outsideName" IS NULL AND "familyNameSnapshot" IS NOT NULL;
--   ALTER TABLE "FundraiserEntry" DROP COLUMN "familyNameSnapshot";

-- AlterTable
ALTER TABLE "FundraiserEntry" ADD COLUMN "familyNameSnapshot" TEXT;
