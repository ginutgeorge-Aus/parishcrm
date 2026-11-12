-- Backfill: EVENT_ORGANISER logins used only as Sunday school roll markers
-- (have a SundaySchoolRollMarker row and no EventManager / GroupLeaderAccess
-- row) become TEACHER. Mixed-use organisers stay EVENT_ORGANISER (their marker
-- rows keep working). Separate migration: the TEACHER enum value added in
-- 20261113000000 must be committed before it can be used.
-- sessionsValidFrom is stamped so the next request re-logs in with the new role.
UPDATE "User" u
SET "role" = 'TEACHER', "sessionsValidFrom" = NOW()
WHERE u."role" = 'EVENT_ORGANISER'
  AND EXISTS (SELECT 1 FROM "SundaySchoolRollMarker" m WHERE m."userId" = u."id")
  AND NOT EXISTS (SELECT 1 FROM "EventManager" e WHERE e."userId" = u."id")
  AND NOT EXISTS (SELECT 1 FROM "GroupLeaderAccess" g WHERE g."userId" = u."id");
