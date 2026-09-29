#!/bin/sh
# Container entrypoint: apply pending migrations, then start the app. Railway
# ignores railway.json for new services (no pre-deploy hook), so migrating at
# start is the only platform-neutral way for a fresh deploy to get a schema.
# `prisma migrate deploy` holds a Postgres advisory lock, so concurrent replicas
# serialise safely. Set MIGRATE_ON_START=false to run migrations yourself.
set -eu
if [ "${MIGRATE_ON_START:-true}" != "false" ]; then
  sh /app/migrate.sh
fi
exec node /app/server.js
