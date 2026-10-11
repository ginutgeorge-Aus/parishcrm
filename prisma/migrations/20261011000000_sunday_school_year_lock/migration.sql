-- Enrolment year is derived from its class; make the DB enforce it (#177) and
-- add the per-year lock written by a rollover (#176).

-- Repair any enrolment whose year disagrees with its class (actions never
-- produce one, but the new FK would reject it). Drop a mismatched row only when
-- the child already has a correct enrolment in the class's year, since moving
-- it would break the (personId, year) unique.
DELETE FROM "SundaySchoolEnrolment" e
USING "SundaySchoolClass" c
WHERE c."id" = e."classId" AND e."year" <> c."year"
  AND EXISTS (
    SELECT 1 FROM "SundaySchoolEnrolment" o
    WHERE o."personId" = e."personId" AND o."year" = c."year" AND o."id" <> e."id"
  );

UPDATE "SundaySchoolEnrolment" e
SET "year" = c."year"
FROM "SundaySchoolClass" c
WHERE c."id" = e."classId" AND e."year" <> c."year";

-- CreateTable
CREATE TABLE "SundaySchoolYearLock" (
    "year" INTEGER NOT NULL,
    "lockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SundaySchoolYearLock_pkey" PRIMARY KEY ("year")
);

-- CreateIndex
CREATE UNIQUE INDEX "SundaySchoolClass_id_year_key" ON "SundaySchoolClass"("id", "year");

-- Swap the single-column class FK for the composite (classId, year) one; the
-- ON DELETE CASCADE / ON UPDATE CASCADE behaviour is unchanged.
ALTER TABLE "SundaySchoolEnrolment" DROP CONSTRAINT "SundaySchoolEnrolment_classId_fkey";

-- AddForeignKey
ALTER TABLE "SundaySchoolEnrolment" ADD CONSTRAINT "SundaySchoolEnrolment_classId_year_fkey" FOREIGN KEY ("classId", "year") REFERENCES "SundaySchoolClass"("id", "year") ON DELETE CASCADE ON UPDATE CASCADE;
