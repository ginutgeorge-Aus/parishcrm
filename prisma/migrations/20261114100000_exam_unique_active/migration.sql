-- Enforce one live exam per (class, year, lower(name), date) at the DB (#664).
-- Prisma cannot model a partial expression index, so this is raw SQL only; it is
-- not represented in schema.prisma (see the comment on SundaySchoolExam).

-- Pre-check: abort with a clear message if live duplicates already exist.
-- A failed migration is recorded as failed, so `migrate deploy` then refuses
-- every later run (P3009) and the container exits at start. To recover:
--   1. archive or rename the extra exams;
--   2. npx prisma migrate resolve --rolled-back 20261114100000_exam_unique_active
--   3. re-run the deploy.
-- Find them manually with:
--   SELECT "classId", year, lower(name), date, array_agg(id) FROM "SundaySchoolExam"
--   WHERE "archivedAt" IS NULL GROUP BY 1,2,3,4 HAVING count(*) > 1;
DO $$
DECLARE
  dupes text;
BEGIN
  SELECT string_agg(format('class %s %s "%s" %s ids [%s]', "classId", year, n, date, ids), '; ') INTO dupes
  FROM (
    SELECT "classId", year, lower(name) AS n, date, string_agg(id::text, ',' ORDER BY id) AS ids
    FROM "SundaySchoolExam" WHERE "archivedAt" IS NULL
    GROUP BY 1, 2, 3, 4 HAVING count(*) > 1
  ) d;
  IF dupes IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot add SundaySchoolExam_active_unique: duplicate live exams exist (%). Archive or rename the extras, run `npx prisma migrate resolve --rolled-back 20261114100000_exam_unique_active`, then redeploy.', dupes;
  END IF;
END $$;

-- CreateIndex
CREATE UNIQUE INDEX "SundaySchoolExam_active_unique"
  ON "SundaySchoolExam" ("classId", year, lower(name), date)
  WHERE "archivedAt" IS NULL;
