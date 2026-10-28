-- Enforce case-insensitive uniqueness of "User".email (#456).
-- Prisma cannot model an expression index, so this is raw SQL only; it is not
-- represented in schema.prisma (see the comment on User.email).

-- Pre-check: abort with a clear message if case-variant duplicates exist.
-- Resolve them (archive/rename/delete the extra accounts) and re-run the deploy.
DO $$
DECLARE
  dupes text;
BEGIN
  SELECT string_agg(e, ', ') INTO dupes
  FROM (
    SELECT lower(email) AS e FROM "User" GROUP BY 1 HAVING count(*) > 1
  ) d;
  IF dupes IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot add User_email_lower_key: case-variant duplicate User emails exist (%). Resolve them first.', dupes;
  END IF;
END $$;

-- CreateIndex
CREATE UNIQUE INDEX "User_email_lower_key" ON "User" (lower(email));
