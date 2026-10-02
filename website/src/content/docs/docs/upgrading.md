---
title: "Upgrading"
description: "ParishCRM releases are tagged (vX.Y.Z) and published as both a git tag and a container image (ghcr.io/<owner>/<repo>:vX.Y.Z). Upgrading means moving both the…"
---

ParishCRM releases are tagged (`vX.Y.Z`) and published as both a git tag and
a container image (`ghcr.io/<owner>/<repo>:vX.Y.Z`). Upgrading means moving
both the database schema and the running container to a new tag together.

## Steps

1. **Back up the database.** Always, before any upgrade that includes a
   schema migration.
2. **Restart the container on the new image tag** — pull
   `ghcr.io/<owner>/<repo>:vX.Y.Z` and recreate the container (or however
   your platform rolls out a new image). The container runs
   `prisma migrate deploy` before the server starts, applying any new
   migrations (a no-op if there are none).
3. **If you set `MIGRATE_ON_START=false`**, run migrations yourself from a
   source checkout at the same tag *before* step 2:
   ```bash
   git fetch --tags && git checkout vX.Y.Z && npm ci
   npx prisma migrate deploy
   ```
   Never use `prisma db push` or `migrate dev` against a real deployment —
   only `migrate deploy`.
4. **On Railway**, change the app service's image tag (Settings → Source) and
   redeploy.
5. **Check `<your-url>/api/health`** returns `200` after the restart.

## What to keep unchanged

- **`ENCRYPTION_KEY*`** and **`AUTH_SECRET`** must stay exactly the same
  across upgrades. Rotating `ENCRYPTION_KEY*` is a deliberate, separate
  procedure (see [Environment Variables](/parishcrm/docs/environment-variables/) →
  Encryption key rotation) — not something that happens incidentally during
  a version upgrade.
- Any custom `THEME_*` / `CHURCH_*` / `APP_*` values you've set — a version
  upgrade never resets configuration.

## Release notes

Check the project's `CHANGELOG.md` for what changed in each release —
notable user-facing changes are also surfaced in-app under **Help → What's
New** after you sign in (see [Help and What's New](/parishcrm/docs/help-and-whats-new/)).

## If something goes wrong

- If `prisma migrate deploy` fails partway, don't try to hand-edit migration
  state — restore the pre-upgrade database backup and get back to a known
  state before retrying.
- If you need to buy time on a risky upgrade step (e.g. a long migration),
  put the site into [maintenance mode](/parishcrm/docs/operations-scripts/#maintenance-mode)
  first so users see a clear "we'll be back shortly" page instead of errors.

## Related pages

- [Installation](/parishcrm/docs/installation/)
- [Environment Variables](/parishcrm/docs/environment-variables/)
- [Operations Scripts](/parishcrm/docs/operations-scripts/)
- [Data Encryption](/parishcrm/docs/data-encryption/)
