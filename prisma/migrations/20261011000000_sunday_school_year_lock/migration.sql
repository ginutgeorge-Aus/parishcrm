-- Enrolment year is derived from its class; make the DB enforce it (#177) and
-- add the per-year lock written by a rollover (#176).

-- Repair any enrolment whose year disagrees with its class (actions never
-- produce one, but the new FK would reject it). Each row's target year is its
-- class's year; at most one row per (personId, target year) can survive the
-- (personId, year) unique. Survivor: a row already matching its class, else the
-- newest (highest id) mismatched row. Every check below reads the pre-statement
-- snapshot, so the survivor is chosen consistently.
DELETE FROM "SundaySchoolEnrolment" e
USING "SundaySchoolClass" c
WHERE c."id" = e."classId" AND e."year" <> c."year"
  AND EXISTS (
    SELECT 1 FROM "SundaySchoolEnrolment" o
    JOIN "SundaySchoolClass" oc ON oc."id" = o."classId"
    WHERE o."personId" = e."personId" AND oc."year" = c."year" AND o."id" <> e."id"
      AND (o."year" = oc."year" OR o."id" > e."id")
  );

-- Move the remaining mismatched rows in two steps: park each on a negative
-- year unique to the row, then set the class year. A single UPDATE can trip the
-- unique mid-statement on a valid chain (2024->2025 while 2025->2026 still
-- holds 2025); after parking, every target key is free.
UPDATE "SundaySchoolEnrolment" e
SET "year" = -e."id"
FROM "SundaySchoolClass" c
WHERE c."id" = e."classId" AND e."year" <> c."year";

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
