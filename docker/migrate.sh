#!/bin/sh
# Apply pending Prisma migrations. Used as the platform pre-deploy command
# (Railway `preDeployCommand`, Render `preDeployCommand`) so a fresh deploy
# needs no shell access. Reads DIRECT_URL ?? DATABASE_URL via prisma.config.ts.
set -eu
cd /opt/prisma-cli
exec node node_modules/prisma/build/index.js migrate deploy
