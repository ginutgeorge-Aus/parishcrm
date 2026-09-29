#!/bin/sh
# Apply pending Prisma migrations. Run by entrypoint.sh on every container start
# (so a fresh deploy needs no shell access); also usable as a platform pre-deploy
# command with MIGRATE_ON_START=false. Reads DIRECT_URL ?? DATABASE_URL via prisma.config.ts.
set -eu
cd /opt/prisma-cli
exec node node_modules/prisma/build/index.js migrate deploy
