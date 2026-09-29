#!/bin/sh
# Container entrypoint: apply pending migrations, then start the app. Railway
# ignores railway.json for new services (no pre-deploy hook), so migrating at
# start is the only platform-neutral way for a fresh deploy to get a schema.
# `prisma migrate deploy` holds a Postgres advisory lock, so concurrent replicas
# serialise; a replica that waits past Prisma's 10s lock timeout fails, so retry
# a few times before giving up. Set MIGRATE_ON_START=false to run them yourself.
set -eu
if [ "${MIGRATE_ON_START:-true}" != "false" ]; then
  attempt=1
  until sh /app/migrate.sh; do
    if [ "$attempt" -ge 3 ]; then
      echo "migrate: failed after $attempt attempts" >&2
      exit 1
    fi
    echo "migrate: attempt $attempt failed, retrying in 10s" >&2
    attempt=$((attempt + 1))
    sleep 10
  done
fi
exec node /app/server.js
